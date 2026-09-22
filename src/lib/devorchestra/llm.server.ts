import type { ProviderConfig } from "./types";
import { normalizeLovableModel } from "./types";

/**
 * Provider abstraction. The agent architecture never talks to a vendor SDK
 * directly - it only calls `callLLM`. Adding a provider means adding a resolver
 * entry here.
 */

export interface ResolvedProvider {
  label: string;
  model: string;
  baseURL: string;
  headers: Record<string, string>;
  isOllama?: boolean;
}

const API_BASE_URLS: Record<ProviderConfig["apiProvider"], string> = {
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  anthropic: "https://api.anthropic.com/v1",
  custom: "",
};

export function resolveProvider(config: ProviderConfig): ResolvedProvider {
  if (config.mode === "ollama") {
    const base = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
    return {
      label: `Ollama (${config.ollamaModel})`,
      model: config.ollamaModel || "qwen2.5:14b",
      baseURL: `${base}/v1`,
      headers: {},
      isOllama: true,
    };
  }

  if (config.mode === "api") {
    const key = config.apiKey?.trim();
    if (!key) {
      throw new Error(
        "No API key provided for API mode. Add a key in the AI Provider panel, or switch to Lovable AI / Ollama.",
      );
    }
    const baseURL = (config.baseUrl?.trim() || API_BASE_URLS[config.apiProvider]).replace(
      /\/+$/,
      "",
    );
    if (!baseURL) {
      throw new Error("A base URL is required for a custom API provider.");
    }
    const headers: Record<string, string> =
      config.apiProvider === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${key}` };
    return {
      label: `${config.apiProvider} (${config.model})`,
      model: config.model,
      baseURL,
      headers,
    };
  }

  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) {
    throw new Error("Lovable AI is not configured on this project (missing gateway key).");
  }
  const model = normalizeLovableModel(config.model);
  return {
    label: `Lovable AI (${model})`,
    model,
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  };
}

function detailOf(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    const e = current as { message?: string; responseBody?: string; cause?: unknown };
    if (e.responseBody) parts.push(String(e.responseBody).slice(0, 400));
    else if (e.message) parts.push(e.message);
    current = e.cause;
  }
  return parts.join(" — ");
}

function statusOf(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    const e = current as { statusCode?: number; status?: number; cause?: unknown };
    if (typeof e.statusCode === "number") return e.statusCode;
    if (typeof e.status === "number") return e.status;
    current = e.cause;
  }
  return undefined;
}

function friendlyError(error: unknown, provider: ResolvedProvider, config: ProviderConfig): Error {
  const raw = detailOf(error) || String(error);
  const status = statusOf(error);

  if (config.mode === "ollama" && /fetch failed|ECONNREFUSED|Failed to fetch|network/i.test(raw)) {
    return new Error(
      `Cannot reach Ollama at ${config.ollamaBaseUrl}. Start it with \`ollama serve\` and pull the model (\`ollama pull ${provider.model}\`). Note: a hosted preview cannot reach your localhost - run this app locally for Ollama mode.`,
    );
  }
  if (status === 402 || /not enough credits|insufficient_quota|exceeded your current quota/i.test(raw)) {
    return new Error(
      config.mode === "lovable"
        ? "The built-in Lovable AI credits for this workspace are used up, so no agent call can run. Top up credits, or switch to the “API model” tab and paste your own provider key."
        : `${provider.label} reports no remaining quota on that key. ${raw}`,
    );
  }
  if (/api key|unauthorized|invalid_api_key|permission/i.test(raw) && !status) {
    return new Error(`${provider.label} rejected the API key. ${raw}`);
  }
  if (status === 400 && /model/i.test(raw)) {
    return new Error(
      `Model "${provider.model}" is not available on ${provider.label}. Pick a different model in the AI Provider panel. (${raw})`,
    );
  }
  if (status === 401 || status === 403) {
    return new Error(`${provider.label} rejected the credentials (HTTP ${status}). ${raw}`);
  }
  if (status === 402) {
    return new Error(`AI credits exhausted for ${provider.label}. Add credits and re-run. ${raw}`);
  }
  if (status === 429) {
    return new Error(`${provider.label} is rate limited (HTTP 429). Wait a moment and retry.`);
  }
  if (status === 404) {
    return new Error(
      `Model "${provider.model}" was not found on ${provider.label}. Pick a different model in the AI Provider panel.`,
    );
  }
  return new Error(`${provider.label} call failed: ${raw}`);
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Direct streaming chat-completions call. Streaming keeps bytes flowing during
 * long agent turns, and reading the response ourselves means the caller sees the
 * provider's real status and error body instead of a generic SDK message.
 */
async function streamChat(provider: ResolvedProvider, system: string, user: string) {
  const body: Record<string, unknown> = {
    model: provider.model,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    ...(provider.isOllama ? { format: "json" } : {}),
  };
  if (/^openai\/gpt-(6|5\.6)/.test(provider.model)) body["reasoning_effort"] = "low";

  const res = await fetch(`${provider.baseURL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...provider.headers },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const detail = (await res.text().catch(() => "")).slice(0, 600);
    let message = detail;
    try {
      const parsed = JSON.parse(detail) as { message?: string; error?: { message?: string } };
      message = parsed.error?.message || parsed.message || detail;
    } catch {
      /* keep raw text */
    }
    throw new ApiError(res.status, message || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
        };
        if (chunk.error?.message) streamError = chunk.error.message;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) text += delta;
      } catch {
        /* ignore keep-alive / partial frames */
      }
    }
  }

  if (streamError && !text.trim()) throw new ApiError(0, streamError);
  return text;
}

export async function callLLM(
  config: ProviderConfig,
  system: string,
  user: string,
): Promise<{ text: string; model: string; label: string }> {
  const provider = resolveProvider(config);

  try {
    const text = await streamChat(provider, system, user);
    if (!text?.trim()) throw new Error("The model returned an empty response.");
    return { text, model: provider.model, label: provider.label };
  } catch (error) {
    throw friendlyError(error, provider, config);
  }
}

/**
 * Extract the first complete JSON object/array from a response,
 * ignoring any markdown fences, preamble, or trailing commentary.
 */
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim();

  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {
    /* continue to extraction */
  }

  // Strip code block fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim()) as T;
    } catch {
      text = fence[1].trim();
    }
  }

  // Find the start of the first object or array
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let startIdx = -1;
  let openChar = "{";
  let closeChar = "}";

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    openChar = "{";
    closeChar = "}";
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    openChar = "[";
    closeChar = "]";
  }

  if (startIdx !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIdx; i < text.length; i++) {
      const char = text[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === "\\") {
          escape = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === openChar) {
        depth++;
      } else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          // Found the end of the first top-level JSON structure
          const candidate = text.slice(startIdx, i + 1);
          try {
            return JSON.parse(candidate) as T;
          } catch {
            // Repair trailing commas before closing braces/brackets
            const repaired = candidate.replace(/,\s*([}\]])/g, "$1");
            return JSON.parse(repaired) as T;
          }
        }
      }
    }
  }

  throw new Error("Could not parse the model's JSON output. Try a stronger model.");
}

export async function callLLMJson<T>(
  config: ProviderConfig,
  system: string,
  user: string,
): Promise<{ data: T; model: string; label: string; raw: string }> {
  const { text, model, label } = await callLLM(config, system, user);
  return { data: parseJsonLoose<T>(text), model, label, raw: text };
}

export async function testProviderConnection(config: ProviderConfig) {
  if (config.mode === "ollama") {
    const base = (config.ollamaBaseUrl || "http://localhost:11434").replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/api/tags`, { method: "GET" });
      if (!res.ok) {
        return { ok: false, message: `Ollama responded with HTTP ${res.status}.` };
      }
      const body = (await res.json()) as { models?: { name: string }[] };
      const names = (body.models ?? []).map((m) => m.name);
      const wanted = config.ollamaModel || "qwen2.5:14b";
      const has = names.some((n) => n === wanted || n.startsWith(wanted.split(":")[0] ?? ""));
      return {
        ok: true,
        message: has
          ? `Connected to Ollama. Model "${wanted}" is available.`
          : `Connected to Ollama, but "${wanted}" is not pulled yet. Run: ollama pull ${wanted}`,
        models: names,
      };
    } catch {
      return {
        ok: false,
        message: `Cannot reach Ollama at ${base}. Start it with \`ollama serve\`. A hosted preview cannot reach your localhost - run DevOrchestra locally for Ollama mode.`,
      };
    }
  }

  try {
    const { text, label } = await callLLM(config, "Reply with the single word: ready", "ping");
    return { ok: true, message: `${label} responded: ${text.trim().slice(0, 60)}` };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

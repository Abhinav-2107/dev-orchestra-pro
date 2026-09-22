import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import type { ProviderConfig } from "./types";

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
  return {
    label: `Lovable AI (${config.model})`,
    model: config.model || "google/gemini-3.7-flash",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": lovableKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  };
}

function detailOf(error: unknown): string {
  // streamText wraps the gateway failure in `cause`; the top-level message is
  // often the useless "No output generated."
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


export async function callLLM(
  config: ProviderConfig,
  system: string,
  user: string,
): Promise<{ text: string; model: string; label: string }> {
  const provider = resolveProvider(config);
  const client = createOpenAICompatible({
    name: "lovable",
    baseURL: provider.baseURL,
    headers: provider.headers,
  });

  try {
    // Streaming on the wire: long agent calls must not sit silent behind a buffered request.
    const result = streamText({
      model: client(provider.model),
      system,
      prompt: user,
      maxRetries: 1,
    });
    const text = await result.text;
    if (!text?.trim()) throw new Error("The model returned an empty response.");
    return { text, model: provider.model, label: provider.label };
  } catch (error) {
    throw friendlyError(error, provider, config);
  }
}

/** Extract the first JSON object from a model response, tolerating fences/prose. */
export function parseJsonLoose<T>(raw: string): T {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model response contained no JSON object.");
  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Repair the two most common LLM JSON defects: trailing commas and raw newlines.
    const repaired = candidate.replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(repaired) as T;
    } catch (error) {
      throw new Error(
        `Could not parse the model's JSON output (${(error as Error).message}). Try a stronger model.`,
      );
    }
  }
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

import { createServerFn } from "@tanstack/react-start";
import type { Stage } from "./devorchestra/pipeline";
import type { ProviderConfig, RunState } from "./devorchestra/types";

interface RunStageInput {
  /** Sent only for the first stage of a run, before the row exists. */
  state?: RunState;
  /** Once the run is persisted the client sends just the id, keeping the request tiny. */
  stateId?: string | null;
  stage: Stage;
  config: ProviderConfig;
}


async function getDb() {
  const { createClient } = await import("@supabase/supabase-js");
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(process.env["SUPABASE_URL"]!, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function persist(state: RunState): Promise<RunState> {
  try {
    const db = await getDb();
    const row = {
      name: state.name,
      requirement: state.requirement,
      mode: state.mode,
      provider: state.providerLabel,
      model: state.model,
      state: state as unknown as Record<string, unknown>,
    };
    if (state.id) {
      await db.from("devorchestra_runs").update(row).eq("id", state.id);
      return state;
    }
    const { data, error } = await db
      .from("devorchestra_runs")
      .insert(row)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    const withId = { ...state, id: (data as { id: string } | null)?.id ?? null };
    if (withId.id) {
      await db
        .from("devorchestra_runs")
        .update({ state: withId as unknown as Record<string, unknown> })
        .eq("id", withId.id);
    }
    return withId;
  } catch {
    // Persistence is best-effort: never lose an in-flight run because of a DB hiccup.
    return state;
  }
}

async function readState(id: string): Promise<RunState | null> {
  const db = await getDb();
  const { data: row } = await db
    .from("devorchestra_runs")
    .select("id, state")
    .eq("id", id)
    .maybeSingle();
  if (!row) return null;
  const state = (row as { state: RunState }).state;
  return { ...state, id: (row as { id: string }).id };
}

export const runStageFn = createServerFn({ method: "POST" })
  .inputValidator((input: RunStageInput) => {
    if (!input?.stage || !input?.config) throw new Error("Invalid stage request");
    if (!input.state && !input.stateId) throw new Error("Invalid stage request");
    return input;
  })
  .handler(async ({ data }) => {
    const { runStage } = await import("./devorchestra/orchestrator.server");
    const loaded = data.stateId ? await readState(data.stateId) : null;
    const base = loaded ?? data.state;
    if (!base) {
      return { ok: false as const, state: null, error: "That run could not be loaded from storage." };
    }
    const working = structuredClone(base);

    try {
      const next = await runStage(working, data.stage, data.config);
      const saved = await persist(next);
      return { ok: true as const, state: saved, error: null };
    } catch (error) {
      const saved = await persist(working);
      return { ok: false as const, state: saved, error: (error as Error).message };
    }
  });

export const testProviderFn = createServerFn({ method: "POST" })
  .inputValidator((input: { config: ProviderConfig }) => input)
  .handler(async ({ data }) => {
    const { testProviderConnection } = await import("./devorchestra/llm.server");
    try {
      return await testProviderConnection(data.config);
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });

export const listRunsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const db = await getDb();
    const { data } = await db
      .from("devorchestra_runs")
      .select("id, name, mode, provider, model, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);
    return (data ?? []) as {
      id: string;
      name: string;
      mode: string;
      provider: string;
      model: string;
      created_at: string;
      updated_at: string;
    }[];
  } catch {
    return [];
  }
});

export const loadRunFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const db = await getDb();
    const { data: row, error } = await db
      .from("devorchestra_runs")
      .select("id, state")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !row) return null;
    const state = (row as { state: RunState }).state;
    return { ...state, id: (row as { id: string }).id } as RunState;
  });

export const deleteRunFn = createServerFn({ method: "POST" })
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const db = await getDb();
    await db.from("devorchestra_runs").delete().eq("id", data.id);
    return { ok: true };
  });

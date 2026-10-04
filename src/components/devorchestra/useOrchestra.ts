import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { runStageFn, loadRunFn } from "@/lib/devorchestra.functions";
import { nextStage, type Stage } from "@/lib/devorchestra/pipeline";
import {
  DEFAULT_PROVIDER_CONFIG,
  SAMPLE_REQUIREMENT,
  createRunState,
  type ProviderConfig,
  type RunState,
} from "@/lib/devorchestra/types";

const PROVIDER_STORAGE_KEY = "devorchestra-provider-config";
const DATABASE_STORAGE_KEY = "devorchestra-database";

export const DATABASE_OPTIONS = [
  { value: "mongodb", label: "MongoDB (Mongoose)" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sqlite", label: "SQLite" },
  { value: "none", label: "No database / in-memory" },
] as const;

export type DatabaseChoice = (typeof DATABASE_OPTIONS)[number]["value"];

function databaseHint(choice: DatabaseChoice): string {
  switch (choice) {
    case "mongodb":
      return "Database: use MongoDB with Mongoose models, reading the connection string from process.env.MONGODB_URI (default mongodb://localhost:27017/<project>). Include a .env.example.";
    case "postgresql":
      return "Database: use PostgreSQL with the pg driver, reading the connection string from process.env.DATABASE_URL. Include a .env.example and a schema.sql.";
    case "mysql":
      return "Database: use MySQL with the mysql2 driver, reading the connection string from process.env.DATABASE_URL. Include a .env.example and a schema.sql.";
    case "sqlite":
      return "Database: use SQLite (better-sqlite3) with a local file database so the app runs with zero external setup.";
    default:
      return "Database: no external database — keep data in memory or in a local JSON file so the app runs with zero setup.";
  }
}

function providerLabel(config: ProviderConfig) {
  if (config.mode === "ollama") return `Ollama · ${config.ollamaModel}`;
  if (config.mode === "api") return `${config.apiProvider} · ${config.model}`;
  return `Lovable AI · ${config.model}`;
}

function modelOf(config: ProviderConfig) {
  return config.mode === "ollama" ? config.ollamaModel : config.model;
}

export function useOrchestra() {
  const [projectName, setProjectName] = useState("Task Manager");
  const [requirement, setRequirement] = useState(SAMPLE_REQUIREMENT);
  const [config, setConfig] = useState<ProviderConfig>(DEFAULT_PROVIDER_CONFIG);
  const [database, setDatabase] = useState<DatabaseChoice>("mongodb");
  const [state, setState] = useState<RunState>(() =>
    createRunState(
      "Task Manager",
      SAMPLE_REQUIREMENT,
      "orchestra",
      providerLabel(DEFAULT_PROVIDER_CONFIG),
      DEFAULT_PROVIDER_CONFIG.model,
    ),
  );
  const [activeStage, setActiveStage] = useState<Stage | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Restore the provider + database choices saved in this browser.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ProviderConfig;
        setConfig({ ...DEFAULT_PROVIDER_CONFIG, ...parsed });
      }
      const savedDb = window.localStorage.getItem(DATABASE_STORAGE_KEY);
      if (savedDb && DATABASE_OPTIONS.some((o) => o.value === savedDb)) {
        setDatabase(savedDb as DatabaseChoice);
      }
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  // Persist provider settings so a reload or Resume never loses them.
  // API keys stay in memory only: strip them before writing to storage.
  useEffect(() => {
    try {
      const { apiKey: _apiKey, ...rest } = config;
      window.localStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable */
    }
  }, [config]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DATABASE_STORAGE_KEY, database);
    } catch {
      /* storage unavailable */
    }
  }, [database]);

  const runStage = useServerFn(runStageFn);
  const loadRun = useServerFn(loadRunFn);

  const drive = useCallback(
    async (initial: RunState) => {
      setRunning(true);
      setError(null);
      stopRef.current = false;
      let current = initial;
      try {
        for (let guard = 0; guard < 60; guard += 1) {
          if (stopRef.current) {
            toast.info("Run stopped.");
            break;
          }
          const stage = nextStage(current);
          if (!stage) break;
          setActiveStage(stage);
          const payload = current.id
            ? { stateId: current.id, stage, config }
            : { state: current, stage, config };
          const result = (await runStage({ data: payload })) as {
            ok: boolean;
            state: RunState | null;
            error: string | null;
          };
          if (result.state) {
            current = result.state;
            setState({ ...current });
          }
          if (!result.ok) {
            setError(result.error ?? "Unknown agent failure");
            toast.error(result.error ?? "Agent failed");
            break;
          }

        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(message);
      } finally {
        setActiveStage(null);
        setRunning(false);
      }
      return current;
    },
    [config, runStage],
  );

  const start = useCallback(
    async (mode: "orchestra" | "baseline") => {
      if (!requirement.trim()) {
        toast.error("Describe what to build first.");
        return;
      }
      const fullRequirement = `${requirement.trim()}\n\n${databaseHint(database)}`;
      const fresh = createRunState(
        projectName.trim() || "Untitled project",
        fullRequirement,
        mode,
        providerLabel(config),
        modelOf(config),
      );
      setState(fresh);
      const final = await drive(fresh);
      if (final.status === "passed") toast.success("Run finished — application generated.");
      else if (final.status === "failed" && final.files.length > 0)
        toast.warning("All sprints built, but some tests still report findings.");
    },
    [config, database, drive, projectName, requirement],
  );

  const resume = useCallback(async () => {
    if (!nextStage(state)) {
      toast.info("Nothing left to run for this project.");
      return;
    }
    await drive(state);
  }, [drive, state]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const open = useCallback(
    async (id: string) => {
      const loaded = (await loadRun({ data: { id } })) as RunState | null;
      if (!loaded) {
        toast.error("Could not load that run.");
        return;
      }
      setState(loaded);
      setProjectName(loaded.name);
      setRequirement(loaded.requirement);
      toast.success(`Loaded "${loaded.name}"`);
    },
    [loadRun],
  );

  return {
    projectName,
    setProjectName,
    requirement,
    setRequirement,
    config,
    setConfig,
    database,
    setDatabase,
    state,
    setState,
    activeStage,
    running,
    error,
    start,
    resume,
    stop,
    open,
  };
}

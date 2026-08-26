import { useCallback, useRef, useState } from "react";
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
          const result = (await runStage({ data: { state: current, stage, config } })) as {
            ok: boolean;
            state: RunState;
            error: string | null;
          };
          current = result.state as RunState;
          setState({ ...current });
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
      const fresh = createRunState(
        projectName.trim() || "Untitled project",
        requirement.trim(),
        mode,
        providerLabel(config),
        modelOf(config),
      );
      setState(fresh);
      const final = await drive(fresh);
      if (final.status === "passed") toast.success("Run finished — application generated.");
    },
    [config, drive, projectName, requirement],
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

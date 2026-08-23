import type { AgentId, RunState } from "./types";

export type Stage =
  | "requirement"
  | "planning"
  | "architecture"
  | "coding"
  | "review"
  | "review-fix"
  | "testing"
  | "correction"
  | "advance"
  | "baseline";

export const STAGE_LABELS: Record<Stage, string> = {
  requirement: "Requirement Agent",
  planning: "Sprint Planning",
  architecture: "Architecture Agent",
  coding: "Coding Agent",
  review: "Review + Dependency",
  "review-fix": "Coding Agent (review fixes)",
  testing: "Testing Agent",
  correction: "Correction loop",
  advance: "Sprint close-out",
  baseline: "Single-LLM baseline",
};

export const STAGE_AGENT: Record<Stage, AgentId> = {
  requirement: "requirement",
  planning: "planning",
  architecture: "architecture",
  coding: "coding",
  review: "review",
  "review-fix": "coding",
  testing: "testing",
  correction: "correction",
  advance: "testing",
  baseline: "baseline",
};

export const PIPELINE_AGENTS: { id: AgentId; label: string }[] = [
  { id: "requirement", label: "Requirement" },
  { id: "planning", label: "Planning" },
  { id: "architecture", label: "Architecture" },
  { id: "coding", label: "Coding" },
  { id: "review", label: "Review" },
  { id: "testing", label: "Testing" },
  { id: "correction", label: "Correction" },
];

/** Pure orchestration policy: what should run next given the persisted state. */
export function nextStage(state: RunState): Stage | null {
  if (state.mode === "baseline") {
    return state.files.length > 0 ? null : "baseline";
  }
  if (!state.requirements) return "requirement";
  if (state.sprints.length === 0) return "planning";

  const s = state.currentSprint;
  if (s >= state.sprints.length) return null;

  if (!state.architectures.some((a) => a.sprint === s)) return "architecture";
  if (!state.files.some((f) => f.sprint === s)) return "coding";

  const review = [...state.reviews].reverse().find((r) => r.sprint === s);
  if (!review) return "review";
  const reviewFixApplied = state.corrections.some((c) => c.sprint === s && c.source === "review");
  if (review.verdict === "needs_changes" && !reviewFixApplied) return "review-fix";

  const sprintTests = state.tests.filter((t) => t.sprint === s);
  const latest = sprintTests[sprintTests.length - 1];
  if (!latest) return "testing";
  if (latest.verdict === "PASS") return "advance";

  if (sprintTests.length >= state.retryLimit) return null; // retry limit reached
  const fixedForAttempt = state.corrections.some(
    (c) => c.sprint === s && c.source === "testing" && c.attempt === latest.attempt,
  );
  return fixedForAttempt ? "testing" : "correction";
}

export function isRunFinished(state: RunState) {
  return nextStage(state) === null;
}

export function fileLanguage(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    py: "python",
    sql: "sql",
    yml: "yaml",
    yaml: "yaml",
  };
  return map[ext] ?? "text";
}

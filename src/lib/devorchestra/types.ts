export type AgentId =
  | "requirement"
  | "planning"
  | "architecture"
  | "coding"
  | "review"
  | "testing"
  | "correction"
  | "baseline";

export type AgentStatus = "pending" | "running" | "completed" | "failed";

export type ProviderMode = "lovable" | "api" | "ollama";

export interface ProviderConfig {
  mode: ProviderMode;
  /** API mode only */
  apiProvider: "openai" | "google" | "anthropic" | "custom";
  apiKey: string;
  /** Optional base URL override for API / custom providers */
  baseUrl: string;
  /** Ollama */
  ollamaBaseUrl: string;
  ollamaModel: string;
  /** Model id used for lovable / api modes */
  model: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
  sprint: number;
  updatedAt: string;
  revision: number;
}

export interface UserStory {
  id: string;
  as_a: string;
  i_want: string;
  so_that: string;
  acceptance_criteria: string[];
  priority: "high" | "medium" | "low";
}

export interface StructuredRequirements {
  project_summary: string;
  functional_requirements: { id: string; title: string; description: string }[];
  non_functional_requirements: { id: string; title: string; description: string }[];
  modules: { name: string; purpose: string }[];
  user_stories: UserStory[];
  assumptions: string[];
}

export interface BacklogItem {
  id: string;
  title: string;
  description: string;
  story_ids: string[];
  estimate_points: number;
  priority: "high" | "medium" | "low";
  depends_on: string[];
}

export interface Sprint {
  index: number;
  name: string;
  goal: string;
  backlog_item_ids: string[];
  status: "pending" | "in_progress" | "passed" | "failed";
  retries: number;
}

export interface Architecture {
  sprint: number;
  overview: string;
  frontend: { stack: string; components: string[] };
  backend: { stack: string; services: string[] };
  database: { engine: string; tables: { name: string; columns: string[] }[] };
  apis: { method: string; path: string; purpose: string }[];
  modules: { name: string; responsibility: string; depends_on: string[] }[];
  dependencies: { name: string; reason: string }[];
  plantuml: string;
}

export interface ReviewResult {
  sprint: number;
  createdAt: string;
  verdict: "clean" | "needs_changes";
  summary: string;
  findings: {
    severity: "critical" | "major" | "minor";
    file: string;
    issue: string;
    suggested_fix: string;
  }[];
  dependency_graph: { from: string; to: string }[];
  missing_functionality: string[];
}

export interface TestCase {
  id: string;
  name: string;
  target_file: string;
  kind: "unit" | "integration" | "e2e";
  expectation: string;
  status: "pass" | "fail";
  failure_reason: string;
}

export interface TestRun {
  sprint: number;
  attempt: number;
  createdAt: string;
  verdict: "PASS" | "FAIL";
  command: string;
  stdout: string;
  stderr: string;
  summary: string;
  cases: TestCase[];
  errors: { file: string; message: string; fix_hint: string }[];
}

export interface CorrectionEntry {
  sprint: number;
  attempt: number;
  createdAt: string;
  source: "review" | "testing";
  instructions: string[];
  changed_files: string[];
}

export interface LogEntry {
  at: string;
  agent: AgentId | "orchestrator";
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface AgentRecord {
  status: AgentStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  model?: string;
  output?: unknown;
  error?: string;
}

export interface RunState {
  id: string | null;
  name: string;
  requirement: string;
  mode: "orchestra" | "baseline";
  providerLabel: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "passed" | "failed";
  currentSprint: number;
  retryLimit: number;
  agents: Record<AgentId, AgentRecord>;
  requirements: StructuredRequirements | null;
  backlog: BacklogItem[];
  sprints: Sprint[];
  architectures: Architecture[];
  files: GeneratedFile[];
  reviews: ReviewResult[];
  tests: TestRun[];
  corrections: CorrectionEntry[];
  logs: LogEntry[];
  finalSummary: string;
}

export const SAMPLE_REQUIREMENT =
  "Build a To-Do application with user registration, login, create/edit/delete tasks, mark tasks complete, and a dashboard.";

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  mode: "lovable",
  apiProvider: "openai",
  apiKey: "",
  baseUrl: "",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:14b",
  model: "google/gemini-3.7-flash",
};

export function emptyAgents(): Record<AgentId, AgentRecord> {
  const ids: AgentId[] = [
    "requirement",
    "planning",
    "architecture",
    "coding",
    "review",
    "testing",
    "correction",
    "baseline",
  ];
  return Object.fromEntries(ids.map((id) => [id, { status: "pending" as AgentStatus }])) as Record<
    AgentId,
    AgentRecord
  >;
}

export function createRunState(
  name: string,
  requirement: string,
  mode: "orchestra" | "baseline",
  providerLabel: string,
  model: string,
): RunState {
  const now = new Date().toISOString();
  return {
    id: null,
    name,
    requirement,
    mode,
    providerLabel,
    model,
    createdAt: now,
    updatedAt: now,
    status: "idle",
    currentSprint: 0,
    retryLimit: 3,
    agents: emptyAgents(),
    requirements: null,
    backlog: [],
    sprints: [],
    architectures: [],
    files: [],
    reviews: [],
    tests: [],
    corrections: [],
    logs: [],
    finalSummary: "",
  };
}

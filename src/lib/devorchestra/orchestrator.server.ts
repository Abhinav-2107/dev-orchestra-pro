import { AGENT_PROMPTS } from "./prompts";
import { callLLMJson } from "./llm.server";
import { fileLanguage, type Stage } from "./pipeline";
import type {
  AgentId,
  JsonValue,
  Architecture,
  BacklogItem,
  GeneratedFile,
  LogEntry,
  ProviderConfig,
  ReviewResult,
  RunState,
  Sprint,
  StructuredRequirements,
  TestRun,
} from "./types";

function log(state: RunState, agent: AgentId | "orchestrator", level: LogEntry["level"], message: string) {
  state.logs.push({ at: new Date().toISOString(), agent, level, message });
  if (state.logs.length > 500) state.logs.splice(0, state.logs.length - 500);
}

function projectSnapshot(state: RunState, max = 22000) {
  const body = state.files
    .map((f) => `--- FILE: ${f.path} (rev ${f.revision}) ---\n${f.content}`)
    .join("\n\n");
  return body.length > max ? `${body.slice(0, max)}\n... [truncated]` : body || "(empty project)";
}

function sprintBrief(state: RunState, sprintIndex: number) {
  const sprint = state.sprints[sprintIndex];
  if (!sprint) return "";
  const items = state.backlog.filter((b) => sprint.backlog_item_ids.includes(b.id));
  const storyIds = new Set(items.flatMap((i) => i.story_ids));
  const stories = (state.requirements?.user_stories ?? []).filter((s) => storyIds.has(s.id));
  return [
    `SPRINT ${sprintIndex + 1}/${state.sprints.length}: ${sprint.name}`,
    `Goal: ${sprint.goal}`,
    `Backlog items:\n${JSON.stringify(items, null, 2)}`,
    `Relevant user stories & acceptance criteria:\n${JSON.stringify(stories, null, 2)}`,
  ].join("\n\n");
}

function mergeFiles(
  state: RunState,
  incoming: { path: string; content: string; language?: string }[],
  sprint: number,
) {
  const changed: string[] = [];
  for (const file of incoming) {
    if (!file?.path || typeof file.content !== "string") continue;
    const path = file.path.replace(/^\.?\//, "");
    const existing = state.files.find((f) => f.path === path);
    if (existing) {
      existing.content = file.content;
      existing.language = file.language || fileLanguage(path);
      existing.revision += 1;
      existing.updatedAt = new Date().toISOString();
      existing.sprint = Math.min(existing.sprint, sprint);
    } else {
      state.files.push({
        path,
        content: file.content,
        language: file.language || fileLanguage(path),
        sprint,
        revision: 1,
        updatedAt: new Date().toISOString(),
      });
    }
    changed.push(path);
  }
  state.files.sort((a, b) => a.path.localeCompare(b.path));
  return changed;
}

/** Best-effort mirror of the generated project onto the server filesystem. */
async function writeWorkspace(state: RunState, files: GeneratedFile[]) {
  try {
    const fs = await import("node:fs/promises");
    const nodePath = await import("node:path");
    const root = nodePath.join("/tmp", "devorchestra", state.id ?? "scratch");
    for (const file of files) {
      const target = nodePath.join(root, file.path);
      await fs.mkdir(nodePath.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content, "utf8");
    }
    return root;
  } catch (error) {
    log(state, "orchestrator", "warn", `Workspace mirror skipped: ${(error as Error).message}`);
    return null;
  }
}

function startAgent(state: RunState, agent: AgentId) {
  state.agents[agent] = { ...state.agents[agent], status: "running", startedAt: new Date().toISOString() };
}

function finishAgent(
  state: RunState,
  agent: AgentId,
  output: unknown,
  model: string,
  startedAt: number,
) {
  const previousStart = state.agents[agent]?.startedAt;
  state.agents[agent] = {
    status: "completed",
    ...(previousStart ? { startedAt: previousStart } : {}),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    model,
    output: JSON.parse(JSON.stringify(output ?? null)) as JsonValue,
  };
}

export async function runStage(
  state: RunState,
  stage: Stage,
  config: ProviderConfig,
): Promise<RunState> {
  const sprintIndex = state.currentSprint;
  const started = Date.now();
  state.status = "running";
  state.updatedAt = new Date().toISOString();

  if (stage === "advance") {
    const sprint = state.sprints[sprintIndex];
    if (sprint) sprint.status = "passed";
    log(state, "orchestrator", "success", `Sprint ${sprintIndex + 1} passed all tests.`);
    state.currentSprint = sprintIndex + 1;
    if (state.currentSprint >= state.sprints.length) {
      state.status = "passed";
      state.finalSummary = `All ${state.sprints.length} sprints passed. ${state.files.length} files generated across ${state.tests.length} test runs and ${state.corrections.length} corrections.`;
      log(state, "orchestrator", "success", "Final application ready.");
    } else {
      const next = state.sprints[state.currentSprint];
      if (next) next.status = "in_progress";
    }
    return state;
  }

  const agent = (
    {
      requirement: "requirement",
      planning: "planning",
      architecture: "architecture",
      coding: "coding",
      "review-fix": "coding",
      review: "review",
      testing: "testing",
      correction: "correction",
      baseline: "baseline",
    } as Record<string, AgentId>
  )[stage]!;

  startAgent(state, agent);
  log(state, agent, "info", `${AGENT_PROMPTS[agent === "coding" && stage === "review-fix" ? "correction" : agent].title} started.`);

  try {
    switch (stage) {
      case "requirement": {
        const { data, model, label } = await callLLMJson<StructuredRequirements>(
          config,
          AGENT_PROMPTS.requirement.system,
          `Product request:\n"""${state.requirement}"""\n\nProject name: ${state.name}`,
        );
        state.requirements = data;
        state.providerLabel = label;
        state.model = model;
        log(
          state,
          "requirement",
          "success",
          `${data.functional_requirements?.length ?? 0} functional requirements, ${data.user_stories?.length ?? 0} user stories extracted.`,
        );
        finishAgent(state, "requirement", data, model, started);
        break;
      }

      case "planning": {
        const { data, model } = await callLLMJson<{ backlog: BacklogItem[]; sprints: Sprint[] }>(
          config,
          AGENT_PROMPTS.planning.system,
          `Structured requirements:\n${JSON.stringify(state.requirements, null, 2)}`,
        );
        state.backlog = data.backlog ?? [];
        state.sprints = (data.sprints ?? []).map((s, i) => ({
          index: i,
          name: s.name,
          goal: s.goal,
          backlog_item_ids: s.backlog_item_ids ?? [],
          status: i === 0 ? "in_progress" : "pending",
          retries: 0,
        }));
        state.currentSprint = 0;
        log(
          state,
          "planning",
          "success",
          `${state.backlog.length} backlog items planned across ${state.sprints.length} sprints.`,
        );
        finishAgent(state, "planning", data, model, started);
        break;
      }

      case "architecture": {
        const { data, model } = await callLLMJson<Omit<Architecture, "sprint">>(
          config,
          AGENT_PROMPTS.architecture.system,
          `${sprintBrief(state, sprintIndex)}\n\nNon-functional requirements:\n${JSON.stringify(
            state.requirements?.non_functional_requirements ?? [],
            null,
            2,
          )}\n\nExisting project files:\n${state.files.map((f) => f.path).join("\n") || "(none yet)"}`,
        );
        const arch: Architecture = { ...(data as Omit<Architecture, "sprint">), sprint: sprintIndex };
        state.architectures = [
          ...state.architectures.filter((a) => a.sprint !== sprintIndex),
          arch,
        ];
        log(state, "architecture", "success", `Architecture defined for sprint ${sprintIndex + 1}.`);
        finishAgent(state, "architecture", arch, model, started);
        break;
      }

      case "coding":
      case "baseline": {
        const isBaseline = stage === "baseline";
        const prompt = isBaseline
          ? `Requirement:\n"""${state.requirement}"""`
          : `${sprintBrief(state, sprintIndex)}\n\nArchitecture:\n${JSON.stringify(
              state.architectures.find((a) => a.sprint === sprintIndex),
              null,
              2,
            )}\n\nCurrent project files (maintain, do not regenerate unchanged files):\n${projectSnapshot(state)}`;
        const { data, model } = await callLLMJson<{
          notes: string;
          run_instructions?: string;
          files: { path: string; content: string; language?: string }[];
        }>(config, AGENT_PROMPTS[isBaseline ? "baseline" : "coding"].system, prompt);
        const changed = mergeFiles(state, data.files ?? [], sprintIndex);
        const root = await writeWorkspace(
          state,
          state.files.filter((f) => changed.includes(f.path)),
        );
        log(
          state,
          isBaseline ? "baseline" : "coding",
          "success",
          `${changed.length} files written${root ? ` to ${root}` : ""}: ${changed.join(", ")}`,
        );
        if (isBaseline) {
          state.status = "passed";
          state.finalSummary = `Baseline run produced ${state.files.length} files in a single LLM pass (no planning, review or testing).`;
        }
        finishAgent(state, isBaseline ? "baseline" : "coding", data, model, started);
        break;
      }

      case "review": {
        const { data, model } = await callLLMJson<Omit<ReviewResult, "sprint" | "createdAt">>(
          config,
          AGENT_PROMPTS.review.system,
          `${sprintBrief(state, sprintIndex)}\n\nArchitecture:\n${JSON.stringify(
            state.architectures.find((a) => a.sprint === sprintIndex),
            null,
            2,
          )}\n\nProject files:\n${projectSnapshot(state)}`,
        );
        const review: ReviewResult = {
          ...(data as Omit<ReviewResult, "sprint" | "createdAt">),
          sprint: sprintIndex,
          createdAt: new Date().toISOString(),
        };
        state.reviews.push(review);
        log(
          state,
          "review",
          review.verdict === "clean" ? "success" : "warn",
          `Review verdict: ${review.verdict} (${review.findings?.length ?? 0} findings).`,
        );
        finishAgent(state, "review", review, model, started);
        break;
      }

      case "review-fix": {
        const review = [...state.reviews].reverse().find((r) => r.sprint === sprintIndex);
        const { data, model } = await callLLMJson<{
          notes: string;
          instructions_applied?: string[];
          files: { path: string; content: string; language?: string }[];
        }>(
          config,
          AGENT_PROMPTS.correction.system,
          `Review findings to fix:\n${JSON.stringify(review, null, 2)}\n\nProject files:\n${projectSnapshot(state)}`,
        );
        const changed = mergeFiles(state, data.files ?? [], sprintIndex);
        await writeWorkspace(state, state.files.filter((f) => changed.includes(f.path)));
        state.corrections.push({
          sprint: sprintIndex,
          attempt: 0,
          createdAt: new Date().toISOString(),
          source: "review",
          instructions: data.instructions_applied ?? (review?.findings ?? []).map((f) => f.issue),
          changed_files: changed,
        });
        log(state, "coding", "success", `Applied review corrections to ${changed.length} files.`);
        finishAgent(state, "coding", data, model, started);
        break;
      }

      case "testing": {
        const attempt = state.tests.filter((t) => t.sprint === sprintIndex).length + 1;
        const { data, model } = await callLLMJson<{
          verdict: "PASS" | "FAIL";
          command: string;
          summary: string;
          stdout: string;
          stderr: string;
          test_files?: { path: string; content: string; language?: string }[];
          cases: TestRun["cases"];
          errors: TestRun["errors"];
        }>(
          config,
          AGENT_PROMPTS.testing.system,
          `${sprintBrief(state, sprintIndex)}\n\nProject files:\n${projectSnapshot(state)}`,
        );
        if (data.test_files?.length) {
          mergeFiles(state, data.test_files, sprintIndex);
          await writeWorkspace(state, state.files.filter((f) => f.path.includes("test")));
        }
        const run: TestRun = {
          sprint: sprintIndex,
          attempt,
          createdAt: new Date().toISOString(),
          verdict: data.verdict === "PASS" ? "PASS" : "FAIL",
          command: data.command ?? "npm test",
          stdout: data.stdout ?? "",
          stderr: data.stderr ?? "",
          summary: data.summary ?? "",
          cases: data.cases ?? [],
          errors: data.errors ?? [],
        };
        state.tests.push(run);
        const sprint = state.sprints[sprintIndex];
        if (sprint && run.verdict === "FAIL") sprint.retries = attempt;
        log(
          state,
          "testing",
          run.verdict === "PASS" ? "success" : "error",
          `Attempt ${attempt}: ${run.verdict} - ${run.cases.filter((c) => c.status === "pass").length}/${run.cases.length} cases passed.`,
        );
        if (run.verdict === "FAIL" && attempt >= state.retryLimit) {
          state.status = "failed";
          state.agents.testing = { ...state.agents.testing, status: "failed" };
          state.finalSummary = `Retry limit (${state.retryLimit}) reached on sprint ${sprintIndex + 1}. Correction loop stopped.`;
          log(state, "orchestrator", "error", state.finalSummary);
          return state;
        }
        finishAgent(state, "testing", run, model, started);
        break;
      }

      case "correction": {
        const sprintTests = state.tests.filter((t) => t.sprint === sprintIndex);
        const latest = sprintTests[sprintTests.length - 1];
        const { data, model } = await callLLMJson<{
          notes: string;
          instructions_applied?: string[];
          files: { path: string; content: string; language?: string }[];
        }>(
          config,
          AGENT_PROMPTS.correction.system,
          `Structured error report from the Testing Agent:\n${JSON.stringify(
            { verdict: latest?.verdict, stderr: latest?.stderr, errors: latest?.errors, failing: latest?.cases?.filter((c) => c.status === "fail") },
            null,
            2,
          )}\n\nProject files:\n${projectSnapshot(state)}`,
        );
        const changed = mergeFiles(state, data.files ?? [], sprintIndex);
        await writeWorkspace(state, state.files.filter((f) => changed.includes(f.path)));
        state.corrections.push({
          sprint: sprintIndex,
          attempt: latest?.attempt ?? 1,
          createdAt: new Date().toISOString(),
          source: "testing",
          instructions: data.instructions_applied ?? (latest?.errors ?? []).map((e) => e.message),
          changed_files: changed,
        });
        log(
          state,
          "correction",
          "success",
          `Correction ${state.corrections.length}: patched ${changed.length} files, re-running tests.`,
        );
        finishAgent(state, "correction", data, model, started);
        break;
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    state.agents[agent] = {
      ...state.agents[agent],
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message,
    };
    state.status = "failed";
    log(state, agent, "error", message);
    throw error;
  }

  state.updatedAt = new Date().toISOString();
  return state;
}

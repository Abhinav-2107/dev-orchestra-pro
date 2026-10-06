import { AGENT_PROMPTS } from "./prompts";
import { callLLMJson } from "./llm.server";
import { fileLanguage, type Stage } from "./pipeline";
import { staticGate, type GateIssue } from "./quality";
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

/**
 * Whole-file project context. Files named in the current findings come first,
 * then package.json / entry / frontend, then the rest. Files are never cut in
 * half (a half file makes the model "fix" it into an empty or broken one);
 * anything over budget is listed by path so the model knows it exists.
 */
function projectSnapshot(state: RunState, focus: string[] = [], max = 30000) {
  if (state.files.length === 0) return "(empty project)";
  const focusSet = new Set(focus);
  const rank = (path: string) => {
    if (focusSet.has(path)) return 0;
    if (path === "package.json") return 1;
    if (/^(index|server|app)\.m?js$/.test(path)) return 2;
    if (path.startsWith("public/")) return 3;
    return 4;
  };
  const ordered = [...state.files].sort((a, b) => rank(a.path) - rank(b.path));
  const parts: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const f of ordered) {
    const block = `--- FILE: ${f.path} (rev ${f.revision}) ---\n${f.content}`;
    if (used + block.length > max && parts.length > 0) {
      omitted.push(`${f.path} (${f.content.length} chars)`);
      continue;
    }
    parts.push(block);
    used += block.length;
  }
  if (omitted.length) {
    parts.push(
      `--- OTHER EXISTING FILES (content omitted for length; they exist and work — do not re-emit unless you change them) ---\n${omitted.join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

function gateText(issues: GateIssue[]) {
  if (!issues.length) return "Automated checks: all passed.";
  return `Automated checks FAILED (these are facts, not opinions — fix every one):\n${issues
    .map((i, n) => `${n + 1}. [${i.file}] ${i.message} Fix: ${i.fix}`)
    .join("\n")}`;
}

function sprintBrief(state: RunState, sprintIndex: number) {
  const sprint = state.sprints[sprintIndex];
  if (!sprint) return "";
  const items = state.backlog.filter((b) => sprint.backlog_item_ids.includes(b.id));
  const storyIds = new Set(items.flatMap((i) => i.story_ids));
  const stories = (state.requirements?.user_stories ?? []).filter((s) => storyIds.has(s.id));
  const isFinal = sprintIndex === state.sprints.length - 1;
  return [
    `Original product request:\n"""${state.requirement}"""`,
    `ALL functional requirements of the product:\n${JSON.stringify(
      state.requirements?.functional_requirements ?? [],
      null,
      2,
    )}`,
    `SPRINT ${sprintIndex + 1}/${state.sprints.length}: ${sprint.name}${isFinal ? " (FINAL SPRINT)" : ""}`,
    `Goal: ${sprint.goal}`,
    `Backlog items:\n${JSON.stringify(items, null, 2)}`,
    `Relevant user stories & acceptance criteria:\n${JSON.stringify(stories, null, 2)}`,
    isFinal
      ? "This is the FINAL sprint: after it, EVERY functional requirement above must work end-to-end — a backend route AND a visible, working control in public/index.html + public/app.js. Every field mentioned in the request (e.g. description, due date) must exist in the model, the API, the form and the list."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
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
    // Never let an empty/stub answer wipe out a real file.
    if (file.content.trim().length < 30) {
      log(state, "orchestrator", "warn", `Ignored empty content returned for ${path}.`);
      continue;
    }
    if (existing && existing.content.length > 400 && file.content.length < existing.content.length * 0.25) {
      log(state, "orchestrator", "warn", `Ignored suspiciously truncated rewrite of ${path} (${file.content.length} vs ${existing.content.length} chars).`);
      continue;
    }
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
    const sprintTests = state.tests.filter((t) => t.sprint === sprintIndex);
    const latest = sprintTests[sprintTests.length - 1];
    const passed = latest?.verdict === "PASS";
    if (sprint) sprint.status = passed ? "passed" : "failed";
    log(
      state,
      "orchestrator",
      passed ? "success" : "warn",
      passed
        ? `Sprint ${sprintIndex + 1} passed all tests.`
        : `Sprint ${sprintIndex + 1} closed with open test failures after ${sprintTests.length} attempts — continuing with the next sprint.`,
    );
    state.currentSprint = sprintIndex + 1;
    if (state.currentSprint >= state.sprints.length) {
      const failed = state.sprints.filter((s) => s.status === "failed").length;
      state.status = failed ? "failed" : "passed";
      state.finalSummary = failed
        ? `${state.sprints.length - failed}/${state.sprints.length} sprints passed. ${state.files.length} files generated across ${state.tests.length} test runs and ${state.corrections.length} corrections. ${failed} sprint(s) still have open test findings.`
        : `All ${state.sprints.length} sprints passed. ${state.files.length} files generated across ${state.tests.length} test runs and ${state.corrections.length} corrections.`;
      log(
        state,
        "orchestrator",
        failed ? "warn" : "success",
        failed ? "Project generated with open findings." : "Final application ready.",
      );
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
        const gate = staticGate(state.files, state.requirement);
        const { data, model } = await callLLMJson<Omit<ReviewResult, "sprint" | "createdAt">>(
          config,
          AGENT_PROMPTS.review.system,
          `${sprintBrief(state, sprintIndex)}\n\nArchitecture:\n${JSON.stringify(
            state.architectures.find((a) => a.sprint === sprintIndex),
            null,
            2,
          )}\n\n${gateText(gate)}\n\nProject files:\n${projectSnapshot(state)}`,
        );
        const review: ReviewResult = {
          ...(data as Omit<ReviewResult, "sprint" | "createdAt">),
          findings: [...(data.findings ?? [])],
          sprint: sprintIndex,
          createdAt: new Date().toISOString(),
        };
        // Deterministic checks override the model's opinion.
        for (const issue of gate) {
          review.findings.push({ severity: "critical", file: issue.file, issue: issue.message, suggested_fix: issue.fix });
        }
        const isFinal = sprintIndex === state.sprints.length - 1;
        const missing = (review.requirements_coverage ?? []).filter((c) => !c.implemented);
        if (isFinal) {
          for (const c of missing) {
            review.findings.push({
              severity: "major",
              file: "(requirement)",
              issue: `Requirement ${c.id} is not implemented end-to-end. ${c.evidence ?? ""}`.trim(),
              suggested_fix: "Implement the backend route, model fields and the matching UI controls in public/.",
            });
          }
        }
        if (review.findings.some((f) => f.severity === "critical" || f.severity === "major")) {
          review.verdict = "needs_changes";
        }
        state.reviews.push(review);
        log(
          state,
          "review",
          review.verdict === "clean" ? "success" : "warn",
          `Review verdict: ${review.verdict} (${review.findings.length} findings, ${gate.length} from automated checks${
            review.requirements_coverage?.length
              ? `, ${review.requirements_coverage.length - missing.length}/${review.requirements_coverage.length} requirements covered`
              : ""
          }).`,
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
          `${sprintBrief(state, sprintIndex)}\n\nReview findings to fix:\n${JSON.stringify(
            { summary: review?.summary, findings: review?.findings, missing_functionality: review?.missing_functionality },
            null,
            2,
          )}\n\nProject files:\n${projectSnapshot(state, (review?.findings ?? []).map((f) => f.file))}`,
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
          log(
            state,
            "orchestrator",
            "warn",
            `Retry limit (${state.retryLimit}) reached on sprint ${sprintIndex + 1}. Recording the findings and moving to the next sprint.`,
          );
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

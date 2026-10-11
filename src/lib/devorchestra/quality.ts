/**
 * Deterministic quality gate. LLM reviewers/testers can "hallucinate a pass",
 * so these checks run as plain code over the generated files and their
 * findings are forced into Review + Testing, which triggers the correction loop.
 */
import type { GeneratedFile } from "./types";

export interface GateIssue {
  file: string;
  message: string;
  fix: string;
}

const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "crypto", "dns", "events", "fs",
  "fs/promises", "http", "https", "net", "os", "path", "process", "querystring",
  "readline", "stream", "string_decoder", "timers", "tls", "url", "util", "zlib",
]);

const CODE_EXT = /\.(m?js|cjs|ts|jsx|tsx|html|css|json|sql|py)$/i;

export function isApiOnly(requirement: string) {
  return /\b(api[\s-]?only|backend[\s-]?only|no (ui|frontend))\b/i.test(requirement);
}

export function wantsReact(requirement: string) {
  return /\breact\b/i.test(requirement);
}

function normalize(path: string) {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function dirOf(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function isTestFile(path: string) {
  return /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$/i.test(path);
}

function isTaskApp(requirement: string) {
  return /\b(to[\s-]?do|todo app|task (?:management|manager|app)|manage tasks)\b/i.test(requirement);
}

function packageName(spec: string) {
  if (spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? spec);
  return NODE_BUILTINS.has(name) || NODE_BUILTINS.has(spec) ? null : name;
}

export function staticGate(files: GeneratedFile[], requirement: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const has = (p: string) => byPath.has(normalize(p));
  const apiOnly = isApiOnly(requirement);
  const reactAllowed = wantsReact(requirement);
  const taskApp = isTaskApp(requirement);

  // 1. Empty, stub or placeholder files.
  for (const f of files) {
    if (!CODE_EXT.test(f.path)) continue;
    const body = f.content.replace(/\s+/g, "");
    if (body.length < 30) {
      issues.push({
        file: f.path,
        message: "File is empty or only a stub.",
        fix: "Write the full, working content of this file.",
      });
      continue;
    }
    if (/\/\/\s*(todo|implement( me)?|your code here|add (logic|code) here)\b/i.test(f.content) || /^\s*\.\.\.\s*$/m.test(f.content)) {
      issues.push({
        file: f.path,
        message: "File contains placeholder / TODO code instead of a real implementation.",
        fix: "Replace every placeholder with complete working code.",
      });
    }
  }

  // 2. package.json + runnable entry point.
  const pkgFile = byPath.get("package.json");
  let pkg: { main?: string; scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;
  if (!pkgFile) {
    issues.push({ file: "package.json", message: "package.json is missing.", fix: "Create package.json with a start script and all dependencies." });
  } else {
    try {
      pkg = JSON.parse(pkgFile.content);
    } catch {
      issues.push({ file: "package.json", message: "package.json is not valid JSON.", fix: "Rewrite package.json as valid JSON." });
    }
  }
  let entry: string | null = null;
  if (pkg) {
    const start = pkg.scripts?.["start"];
    if (!start) {
      issues.push({ file: "package.json", message: 'No "start" script.', fix: 'Add "scripts": { "start": "node index.js" }.' });
    }
    const fromStart = start?.match(/node(?:mon)?\s+([\w./-]+\.m?js)/)?.[1];
    entry = normalize(fromStart ?? pkg.main ?? "index.js");
    if (!has(entry)) {
      issues.push({
        file: entry,
        message: `Entry point "${entry}" referenced by package.json does not exist.`,
        fix: `Create ${entry}: create the Express app, mount all routes, serve the public/ folder with express.static and call app.listen(process.env.PORT || 3000).`,
      });
    }
  }

  // 3. Frontend: plain HTML/CSS/JS in public/.
  if (!apiOnly) {
    const html = byPath.get("public/index.html");
    if (!html) {
      issues.push({ file: "public/index.html", message: "Frontend page public/index.html is missing.", fix: "Create public/index.html with the full UI markup, linking style.css and app.js." });
    } else {
      const refs = [
        ...html.content.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
        ...html.content.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi),
      ].map((m) => m[1]!);
      if (!refs.some((r) => /\.js$/.test(r))) {
        issues.push({ file: "public/index.html", message: "index.html does not load any JavaScript file.", fix: 'Add <script src="app.js" defer></script>.' });
      }
      for (const ref of refs) {
        if (/^(https?:)?\/\//.test(ref)) continue;
        const target = normalize(ref.startsWith("/") ? `public${ref}` : `public/${ref}`);
        if (!has(target)) {
          issues.push({ file: "public/index.html", message: `index.html references "${ref}" but ${target} does not exist.`, fix: `Create ${target}.` });
        }
      }
    }
    const appJs = byPath.get("public/app.js");
    if (appJs && !/fetch\s*\(/.test(appJs.content)) {
      issues.push({ file: "public/app.js", message: "Frontend script never calls the backend API (no fetch()).", fix: "Call the REST endpoints with fetch() for every feature in the UI." });
    }
    if (entry && byPath.get(entry) && !/express\.static/.test(byPath.get(entry)!.content) && html) {
      issues.push({ file: entry, message: "The server does not serve the public/ frontend.", fix: "Add app.use(express.static(path.join(__dirname, 'public')))." });
    }
    if (!reactAllowed) {
      const reactFiles = files.filter((f) => /\.(jsx|tsx)$/.test(f.path)).map((f) => f.path);
      const reactDep = pkg && (pkg.dependencies?.["react"] || pkg.devDependencies?.["react"]);
      if (reactFiles.length || reactDep) {
        issues.push({
          file: reactFiles[0] ?? "package.json",
          message: `React is not part of this stack (found: ${reactFiles.join(", ") || "react dependency"}).`,
          fix: "Implement the UI as plain public/index.html + public/style.css + public/app.js and drop React/JSX files and dependencies.",
        });
      }
    }
  }

  // 4. Broken local imports + undeclared npm dependencies.
  const declared = new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
  for (const f of files) {
    if (!/\.(m?js|cjs|ts)$/.test(f.path)) continue;
    const specs = [
      ...f.content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g),
      ...f.content.matchAll(/(?:import|export)\s[^"';]*?from\s+["']([^"']+)["']/g),
    ].map((m) => m[1]!);
    for (const spec of specs) {
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const base = normalize(`${dirOf(f.path)}/${spec}`);
        const candidates = [base, `${base}.js`, `${base}.json`, `${base}.mjs`, `${base}.cjs`, `${base}.ts`, `${base}/index.js`];
        if (!candidates.some((c) => byPath.has(c))) {
          issues.push({ file: f.path, message: `Imports "${spec}" but ${base}(.js) does not exist.`, fix: `Create ${base}.js or fix the import path.` });
        }
      } else if (pkg && !f.path.startsWith("public/")) {
        const name = packageName(spec);
        if (name && !declared.has(name)) {
          issues.push({ file: "package.json", message: `"${name}" is used in ${f.path} but not declared in package.json.`, fix: `Add "${name}" to dependencies.` });
        }
      }
    }
  }

  // 5. Tests must contain actual assertions, not only a plausible test title.
  const testFiles = files.filter((f) => isTestFile(f.path));
  const testSource = testFiles.map((f) => f.content).join("\n");
  for (const f of testFiles) {
    if (f.content.length < 200 || !/\b(test|it|describe)\s*\(/.test(f.content) || !/\bassert\./i.test(f.content)) {
      issues.push({ file: f.path, message: "Test file is a placeholder or has no assertions.", fix: "Write real test cases with assertions against the actual routes/functions." });
    }
  }

  // Task applications need field-level editing, useful dashboard summaries,
  // and named tests for each user workflow. These checks are static only.
  if (taskApp) {
    const backendFiles = files.filter((f) =>
      /\.(?:[cm]?js|ts|sql)$/i.test(f.path) && !f.path.startsWith("public/") && !isTestFile(f.path),
    );
    const backendSource = backendFiles.map((f) => f.content).join("\n");
    const modelFiles = backendFiles.filter((f) => /(?:model|schema|migration)/i.test(f.path));
    if (!modelFiles.some((f) => /\btitle\b/i.test(f.content) && /\bdescription\b/i.test(f.content))) {
      issues.push({
        file: modelFiles[0]?.path ?? "models/Task.js",
        message: "Task model/schema does not define both title and description fields.",
        fix: "Define title and description on the task model/schema and persist both fields.",
      });
    }

    const updateAnchors = [...backendSource.matchAll(/exports\.(?:update|edit)\b|(?:async\s+)?function\s+(?:update|edit)\w*\b|(?:const|let)\s+(?:update|edit)\w*\s*=|(?:update|edit)(?:Task|Todo)\s*:\s*async/gi)];
    const updateBodies = updateAnchors.map((match, index) => {
      const start = match.index ?? 0;
      const next = updateAnchors[index + 1]?.index ?? backendSource.length;
      return backendSource.slice(start, next);
    });
    const writesEditableFields = updateBodies.some((body) =>
      /\btitle\b/i.test(body) && /\bdescription\b/i.test(body) &&
      (/\bUPDATE\s+\w+\s+SET\b/i.test(body) || /\.(?:update|updateOne|findByIdAndUpdate|save)\s*\(/i.test(body)),
    );
    if (!writesEditableFields) {
      issues.push({
        file: backendFiles.find((f) => /task|todo/i.test(f.path) && /update|edit/i.test(f.content))?.path ?? "taskController.js",
        message: "Task update logic does not persist both title and description.",
        fix: "Make the task update endpoint accept and save title and description, not only completion status.",
      });
    }
    const routeWired = backendFiles.some((f) =>
      /\b(?:router|app)\.(?:put|patch)\s*\(/i.test(f.content) &&
      /(?:task|todo|:\w*id)/i.test(f.content) && /update|edit/i.test(f.content),
    );
    if (!routeWired) {
      issues.push({
        file: "routes/",
        message: "No PUT/PATCH task route is wired to update logic.",
        fix: "Wire a task PUT/PATCH endpoint to the update handler, including the task ID route parameter.",
      });
    }

    if (!apiOnly && /\bdashboard\b/i.test(requirement)) {
      const frontend = files.filter((f) => f.path.startsWith("public/")).map((f) => f.content).join("\n");
      const hasMetrics = /\b(?:total|all)\b/i.test(frontend) && /\b(?:active|pending)\b/i.test(frontend) && /\bcompleted\b/i.test(frontend);
      const hasTaskList = /taskList|task-list|task list/i.test(frontend);
      const hasFilters = /\ball\b/i.test(frontend) && /\bactive\b/i.test(frontend) && /\bcompleted\b/i.test(frontend) && /filter|data-filter|filterTasks/i.test(frontend);
      if (!hasMetrics || !hasTaskList || !hasFilters) {
        issues.push({
          file: "public/index.html",
          message: "Task dashboard lacks total/active/completed summaries, a task list, or All/Active/Completed filters.",
          fix: "Build a dashboard with total, active and completed counts, a task list, and working All/Active/Completed filters.",
        });
      }
    }

    const appScripts = files.filter((f) => f.path.startsWith("public/") && /\.js$/i.test(f.path)).map((f) => f.content).join("\n");
    const hasEditUi = /edit(?:Task|Todo|task|todo)|edit-button|saveEdit|editing/i.test(appScripts) &&
      /\btitle\b/i.test(appScripts) && /\bdescription\b/i.test(appScripts) &&
      /method\s*:\s*["'`](?:PUT|PATCH)["'`]/i.test(appScripts);
    if (!apiOnly && !hasEditUi) {
      issues.push({
        file: "public/app.js",
        message: "Frontend has no edit workflow that submits updated task title and description.",
        fix: "Add an edit form/action for title and description and submit both with PUT/PATCH.",
      });
    }

    const testCases = [...testSource.matchAll(/\b(?:test|it)\s*\(\s*(["'`])([^"'`]+)\1/gi)].map((match) => match[2] ?? "");
    const requiresTest = (scenario: string, matcher: RegExp, file: string, fix: string) => {
      if (!testCases.some((name) => matcher.test(name))) {
        issues.push({ file, message: `Test suite has no named ${scenario} task scenario.`, fix });
      }
    };
    requiresTest("create", /create|add/i, "tests/test-tasks.js", "Add an asserted integration test that creates a task through the API.");
    requiresTest("edit", /edit|update/i, "tests/test-tasks.js", "Add an asserted integration test that edits both task title and description.");
    requiresTest("delete", /delete|remove/i, "tests/test-tasks.js", "Add an asserted integration test that deletes a task through the API.");
    requiresTest("completion", /complete|toggle|status/i, "tests/test-tasks.js", "Add an asserted integration test that marks a task complete and verifies the response.");
    requiresTest("frontend interaction", /frontend|front-end|ui|e2e|end.to.end/i, "tests/test-frontend.js", "Add an asserted frontend test for the generated task controls and API interaction.");
    requiresTest("end-to-end workflow", /end.to.end|e2e|full workflow/i, "tests/test-tasks.js", "Add an end-to-end test that creates, edits, completes, filters, and deletes a task.");
    if (/edit|update/i.test(testCases.join(" ")) && (!/\b(?:PUT|PATCH)\b/i.test(testSource) || !/\btitle\b/i.test(testSource) || !/\bdescription\b/i.test(testSource))) {
      issues.push({
        file: "tests/test-tasks.js",
        message: "Task edit tests do not assert a PUT/PATCH update containing both title and description.",
        fix: "Send title and description in the edit test request and assert the updated values in the response.",
      });
    }
    if (/frontend|front-end|ui|e2e|end.to.end/i.test(testCases.join(" ")) &&
        (!/public\/(?:app\.js|index\.html)/i.test(testSource) || !/\bassert\./i.test(testSource))) {
      issues.push({
        file: "tests/test-frontend.js",
        message: "Frontend tests do not assert against the generated public files.",
        fix: "Read public/index.html and public/app.js in a test and assert expected controls and interaction logic exist.",
      });
    }
  }

  // De-duplicate.
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.file}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function staticTestDisclosure(verdict: "PASS" | "FAIL") {
  return {
    command: "Static file review (generated code not executed)",
    stdout: "",
    stderr: "The generated application and its test suite were not executed; this result is based on file inspection only.",
    summary: verdict === "PASS"
      ? "Static checks passed by source inspection only; no generated application or test command was run."
      : "Static checks found issues by source inspection; no generated application or test command was run.",
  };
}

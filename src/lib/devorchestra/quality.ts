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

function packageName(spec: string) {
  if (spec.startsWith("node:")) return null;
  const parts = spec.split("/");
  const name = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  return NODE_BUILTINS.has(name) || NODE_BUILTINS.has(spec) ? null : name;
}

export function staticGate(files: GeneratedFile[], requirement: string): GateIssue[] {
  const issues: GateIssue[] = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const has = (p: string) => byPath.has(normalize(p));
  const apiOnly = isApiOnly(requirement);
  const reactAllowed = wantsReact(requirement);

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

  // 5. Tests must be real.
  for (const f of files.filter((x) => isTestFile(x.path))) {
    if (f.content.length < 200 || !/\b(test|it|describe)\s*\(/.test(f.content)) {
      issues.push({ file: f.path, message: "Test file is a placeholder (no real test cases).", fix: "Write real test cases with assertions against the actual routes/functions." });
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

import { describe, expect, it } from "bun:test";
import { staticGate, staticTestDisclosure } from "./quality";
import type { GeneratedFile } from "./types";

function file(path: string, content: string): GeneratedFile {
  return { path, content, language: "javascript", sprint: 0, updatedAt: "2026-10-10T00:00:00Z", revision: 1 };
}

function completeTaskProject(): GeneratedFile[] {
  return [
    file("package.json", JSON.stringify({ main: "index.js", scripts: { start: "node index.js" }, dependencies: { express: "^4.0.0" } })),
    file("index.js", "const express = require('express'); const app = express(); app.use(express.static('public'));"),
    file("models/Task.js", "const Task = { title: String, description: String }; module.exports = Task;"),
    file("taskController.js", "exports.update = async (req, res) => { const { title, description } = req.body; await db.execute('UPDATE tasks SET title = ?, description = ? WHERE id = ?', [title, description, req.params.id]); } exports.create = async () => {}; exports.delete = async () => {};"),
    file("routes/taskRoutes.js", "router.put('/:id', taskController.update);"),
    file("public/index.html", "<link href='style.css'><main><b>Total</b><b>Active</b><b>Completed</b><button data-filter='all'>All</button><button data-filter='active'>Active</button><button data-filter='completed'>Completed</button><div id='taskList'></div><script src='app.js'></script></main>"),
    file("public/style.css", "body { color: black; }"),
    file("public/app.js", "async function editTask(id, title, description) { return fetch('/api/tasks/' + id, { method: 'PUT', body: JSON.stringify({ title, description }) }); } function filterTasks() {}"),
    file("tests/test-tasks.js", [
      "const test = require('node:test'); const assert = require('node:assert');",
      "test('creates a task', async () => { const response = await fetch('/api/tasks', { method: 'POST' }); assert.equal(response.status, 201); });",
      "test('edits task title and description', async () => { const response = await fetch('/api/tasks/1', { method: 'PUT', body: JSON.stringify({ title: 'Updated', description: 'Details' }) }); assert.equal(response.status, 200); });",
      "test('deletes a task', async () => { const response = await fetch('/api/tasks/1', { method: 'DELETE' }); assert.equal(response.status, 200); });",
      "test('completes a task', async () => { const response = await fetch('/api/tasks/1', { method: 'PUT', body: JSON.stringify({ status: 'completed' }) }); assert.equal(response.status, 200); });",
      "test('frontend interaction', () => { const app = fs.readFileSync('public/app.js'); assert.ok(app.includes('editTask')); });",
      "test('end-to-end workflow creates edits completes filters and deletes', async () => { assert.ok(true); });",
    ].join("\n")),
  ];
}

const requirement = "Build a To-Do task manager with editable title and description and a dashboard.";

describe("task application quality gate", () => {
  it("rejects task updates that persist status but not editable title and description", () => {
    const files = completeTaskProject();
    const controller = files.find((entry) => entry.path === "taskController.js");
    if (!controller) throw new Error("fixture task controller is missing");
    controller.content = "exports.update = async (req, res) => { const { status } = req.body; await db.execute('UPDATE tasks SET status = ?', [status]); };";
    expect(staticGate(files, requirement).some((issue) => issue.message.includes("does not persist both title and description"))).toBe(true);
  });

  it("rejects dashboards without all three counts and task filters", () => {
    const files = completeTaskProject();
    const page = files.find((entry) => entry.path === "public/index.html");
    if (!page) throw new Error("fixture dashboard is missing");
    page.content = "<main><b>Active</b><div id='taskList'></div><script src='app.js'></script></main>";
    expect(staticGate(files, requirement).some((issue) => issue.message.includes("Task dashboard lacks"))).toBe(true);
  });

  it("rejects task suites without named CRUD and frontend interaction cases", () => {
    const files = completeTaskProject();
    const tests = files.find((entry) => entry.path === "tests/test-tasks.js");
    if (!tests) throw new Error("fixture task tests are missing");
    tests.content = "const test = require('node:test'); const assert = require('node:assert'); test('task API', () => { assert.ok(true); });";
    const issues = staticGate(files, requirement);
    expect(issues.some((issue) => issue.message.includes("named edit task scenario"))).toBe(true);
    expect(issues.some((issue) => issue.message.includes("named frontend interaction task scenario"))).toBe(true);
  });

  it("discloses that generated code and test files were not executed", () => {
    const report = staticTestDisclosure("PASS");
    expect(report.command).toContain("not executed");
    expect(report.stdout).toBe("");
    expect(report.stderr).toContain("were not executed");
    expect(report.summary).toContain("source inspection only");
  });
});
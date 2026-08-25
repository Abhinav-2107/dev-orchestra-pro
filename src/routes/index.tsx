import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  CircuitBoard,
  FlaskConical,
  Play,
  RotateCw,
  Square,
  Wand2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AgentPipeline } from "@/components/devorchestra/AgentPipeline";
import { ArchitectureView } from "@/components/devorchestra/ArchitectureView";
import { FileBrowser } from "@/components/devorchestra/FileBrowser";
import { LogsView } from "@/components/devorchestra/LogsView";
import { ProviderPanel } from "@/components/devorchestra/ProviderPanel";
import { RequirementsView } from "@/components/devorchestra/RequirementsView";
import { ReviewView } from "@/components/devorchestra/ReviewView";
import { SprintBoard } from "@/components/devorchestra/SprintBoard";
import { TestView } from "@/components/devorchestra/TestView";
import { useOrchestra } from "@/components/devorchestra/useOrchestra";
import { listRunsFn } from "@/lib/devorchestra.functions";
import { STAGE_LABELS } from "@/lib/devorchestra/pipeline";
import { SAMPLE_REQUIREMENT } from "@/lib/devorchestra/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DevOrchestra — Multi-Agent LLM Software Factory" },
      {
        name: "description",
        content:
          "DevOrchestra coordinates requirement, planning, architecture, coding, review and testing agents through sprint-based iterations to generate working applications.",
      },
      { property: "og:title", content: "DevOrchestra — Multi-Agent LLM Software Factory" },
      {
        property: "og:description",
        content:
          "Sprint-based multi-agent orchestration for automated software development, with a single-LLM baseline for comparison.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const orchestra = useOrchestra();
  const { state, running, activeStage, error } = orchestra;
  const listRuns = useServerFn(listRunsFn);
  const runs = useQuery({
    queryKey: ["devorchestra-runs", state.id, state.updatedAt],
    queryFn: () => listRuns(),
  });

  const passedSprints = state.sprints.filter((s) => s.status === "passed").length;

  return (
    <main className="mx-auto max-w-[1500px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CircuitBoard className="size-5 text-primary" />
            <span className="mono-label">Multi-agent LLM software factory</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">DevOrchestra</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Specialised agents — requirement, planning, architecture, coding, review/dependency and
            testing — coordinated through sprint-based iterations with an automatic correction loop.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[10px]">
            {state.mode === "baseline" ? "BASELINE MODE" : "DEVORCHESTRA MODE"}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px]">
            {state.providerLabel}
          </Badge>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Project</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <Label className="mono-label">Project name</Label>
                <Input
                  value={orchestra.projectName}
                  onChange={(event) => orchestra.setProjectName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="mono-label">Requirement (natural language)</Label>
                <Textarea
                  value={orchestra.requirement}
                  rows={6}
                  onChange={(event) => orchestra.setRequirement(event.target.value)}
                  className="text-xs"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => orchestra.setRequirement(SAMPLE_REQUIREMENT)}
                >
                  <Wand2 /> Load sample To-Do project
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">AI provider</CardTitle>
            </CardHeader>
            <CardContent>
              <ProviderPanel config={orchestra.config} onChange={orchestra.setConfig} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                className="w-full"
                disabled={running}
                onClick={() => orchestra.start("orchestra")}
              >
                <Play /> Start development
              </Button>
              <Button
                variant="secondary"
                className="w-full"
                disabled={running}
                onClick={() => orchestra.start("baseline")}
              >
                <FlaskConical /> Run single-LLM baseline
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={running}
                  onClick={orchestra.resume}
                >
                  <RotateCw /> Resume
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={!running}
                  onClick={orchestra.stop}
                >
                  <Square /> Stop
                </Button>
              </div>
              {activeStage && (
                <p className="font-mono text-[11px] text-primary">
                  running: {STAGE_LABELS[activeStage]}
                </p>
              )}
              {error && (
                <div className="flex gap-2 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Saved runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {(runs.data ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No runs stored yet.</p>
              )}
              {(runs.data ?? []).map((run) => (
                <button
                  key={run.id}
                  onClick={() => orchestra.open(run.id)}
                  className="w-full rounded border border-border bg-surface-raised px-2.5 py-2 text-left transition-colors hover:border-primary/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{run.name}</span>
                    <span className="font-mono text-[9px] uppercase text-muted-foreground">
                      {run.mode}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {run.model} · {new Date(run.updated_at).toLocaleString()}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span className="mono-label">Current sprint</span>
                  <p className="font-mono text-lg">
                    {state.sprints.length
                      ? `${Math.min(state.currentSprint + 1, state.sprints.length)} / ${state.sprints.length}`
                      : "—"}
                  </p>
                </div>
                <Separator orientation="vertical" className="h-10" />
                <div>
                  <span className="mono-label">Status</span>
                  <p className="flex items-center gap-1.5 font-mono text-sm">
                    {state.status === "passed" && (
                      <CheckCircle2 className="size-4 text-success" />
                    )}
                    {state.status}
                  </p>
                </div>
                <Separator orientation="vertical" className="h-10" />
                <div>
                  <span className="mono-label">Files</span>
                  <p className="font-mono text-lg">{state.files.length}</p>
                </div>
                <div>
                  <span className="mono-label">Test runs</span>
                  <p className="font-mono text-lg">{state.tests.length}</p>
                </div>
                <div>
                  <span className="mono-label">Corrections</span>
                  <p className="font-mono text-lg">{state.corrections.length}</p>
                </div>
                <div>
                  <span className="mono-label">Sprints passed</span>
                  <p className="font-mono text-lg">
                    {passedSprints}/{state.sprints.length || 0}
                  </p>
                </div>
              </div>

              <AgentPipeline state={state} />

              {state.finalSummary && (
                <div className="rounded border border-primary/40 bg-primary/10 p-3 text-xs text-primary">
                  {state.finalSummary}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="requirements">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="requirements">Requirements</TabsTrigger>
                  <TabsTrigger value="sprints">Backlog & sprints</TabsTrigger>
                  <TabsTrigger value="architecture">Architecture</TabsTrigger>
                  <TabsTrigger value="files">Files</TabsTrigger>
                  <TabsTrigger value="review">Review</TabsTrigger>
                  <TabsTrigger value="tests">Tests</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>
                <div className="mt-4">
                  <TabsContent value="requirements">
                    <RequirementsView state={state} />
                  </TabsContent>
                  <TabsContent value="sprints">
                    <SprintBoard state={state} />
                  </TabsContent>
                  <TabsContent value="architecture">
                    <ArchitectureView state={state} />
                  </TabsContent>
                  <TabsContent value="files">
                    <FileBrowser state={state} />
                  </TabsContent>
                  <TabsContent value="review">
                    <ReviewView state={state} />
                  </TabsContent>
                  <TabsContent value="tests">
                    <TestView state={state} />
                  </TabsContent>
                  <TabsContent value="logs">
                    <LogsView state={state} />
                  </TabsContent>
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

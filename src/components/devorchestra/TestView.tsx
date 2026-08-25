import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

export function TestView({ state }: { state: RunState }) {
  if (state.tests.length === 0) {
    return <p className="text-sm text-muted-foreground">The Testing Agent has not run yet.</p>;
  }

  return (
    <div className="space-y-4">
      {[...state.tests].reverse().map((run, index) => (
        <Card key={`${run.sprint}-${run.attempt}-${index}`} className="gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-label">
              Sprint {run.sprint + 1} · attempt {run.attempt}
            </span>
            <Badge
              variant="secondary"
              className={cn(
                "font-mono text-[10px]",
                run.verdict === "PASS"
                  ? "bg-success/15 text-success"
                  : "bg-destructive/15 text-destructive",
              )}
            >
              {run.verdict}
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground">{run.command}</span>
          </div>
          <p className="text-xs text-muted-foreground">{run.summary}</p>

          <div className="space-y-1.5">
            {(run.cases ?? []).map((testCase) => (
              <div
                key={testCase.id}
                className="rounded border border-border bg-surface-raised p-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "font-mono text-[10px]",
                      testCase.status === "pass" ? "text-success" : "text-destructive",
                    )}
                  >
                    {testCase.status === "pass" ? "✓ PASS" : "✕ FAIL"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {testCase.id} · {testCase.kind}
                  </span>
                  <span className="font-medium">{testCase.name}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{testCase.expectation}</p>
                {testCase.failure_reason && (
                  <p className="mt-1 text-destructive">{testCase.failure_reason}</p>
                )}
              </div>
            ))}
          </div>

          {(run.stdout || run.stderr) && (
            <pre className="scroll-slim max-h-56 overflow-auto rounded border border-border bg-background p-3 text-[11px] leading-relaxed">
              {run.stdout}
              {run.stderr ? `\n${run.stderr}` : ""}
            </pre>
          )}
        </Card>
      ))}

      {state.corrections.length > 0 && (
        <Card className="gap-2 p-4">
          <span className="mono-label">Retry / correction history</span>
          {state.corrections.map((correction, index) => (
            <div key={index} className="rounded border border-border bg-surface-raised p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {correction.source}
                </Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  sprint {correction.sprint + 1} · attempt {correction.attempt} ·{" "}
                  {new Date(correction.createdAt).toLocaleTimeString()}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {correction.instructions.map((instruction, i) => (
                  <li key={i}>• {instruction}</li>
                ))}
              </ul>
              <p className="mt-1 font-mono text-[10px] text-primary">
                {correction.changed_files.join(", ")}
              </p>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

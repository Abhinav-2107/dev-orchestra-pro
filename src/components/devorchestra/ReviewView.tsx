import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

const SEVERITY: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive",
  major: "bg-warning/15 text-warning",
  minor: "bg-muted text-muted-foreground",
};

export function ReviewView({ state }: { state: RunState }) {
  if (state.reviews.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The Review + Dependency Agent has not run yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {state.reviews.map((review, index) => (
        <Card key={`${review.sprint}-${index}`} className="gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono-label">Sprint {review.sprint + 1} review</span>
            <Badge
              variant="secondary"
              className={cn(
                "font-mono text-[10px] uppercase",
                review.verdict === "clean"
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning",
              )}
            >
              {review.verdict}
            </Badge>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {new Date(review.createdAt).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{review.summary}</p>

          <div className="space-y-2">
            {(review.findings ?? []).map((finding, i) => (
              <div key={i} className="rounded border border-border bg-surface-raised p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={cn("font-mono text-[10px] uppercase", SEVERITY[finding.severity])}
                  >
                    {finding.severity}
                  </Badge>
                  <span className="font-mono text-[11px] text-primary">{finding.file}</span>
                </div>
                <p className="mt-1.5">{finding.issue}</p>
                <p className="mt-1 text-muted-foreground">Fix: {finding.suggested_fix}</p>
              </div>
            ))}
          </div>

          {(review.missing_functionality ?? []).length > 0 && (
            <div>
              <span className="mono-label">Missing functionality</span>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {review.missing_functionality.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          )}

          {(review.dependency_graph ?? []).length > 0 && (
            <div>
              <span className="mono-label">Dependency graph</span>
              <div className="mt-1 space-y-1 font-mono text-[11px]">
                {review.dependency_graph.map((edge, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-foreground">{edge.from}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-primary">{edge.to}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

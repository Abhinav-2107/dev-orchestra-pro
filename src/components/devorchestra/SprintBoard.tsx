import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

const SPRINT_STATUS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  passed: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
};

export function SprintBoard({ state }: { state: RunState }) {
  if (state.sprints.length === 0) {
    return <p className="text-sm text-muted-foreground">No sprints planned yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-3">
        {state.sprints.map((sprint) => {
          const items = state.backlog.filter((b) => sprint.backlog_item_ids.includes(b.id));
          const tests = state.tests.filter((t) => t.sprint === sprint.index);
          return (
            <Card key={sprint.index} className="gap-3 border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="mono-label">Sprint {sprint.index + 1}</span>
                <Badge
                  className={cn("font-mono text-[10px] uppercase", SPRINT_STATUS[sprint.status])}
                  variant="secondary"
                >
                  {sprint.status.replace("_", " ")}
                </Badge>
              </div>
              <h4 className="text-sm font-semibold text-foreground">{sprint.name}</h4>
              <p className="text-xs text-muted-foreground">{sprint.goal}</p>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded border border-border/70 bg-surface-raised px-2 py-1.5 text-xs"
                  >
                    <span className="font-mono text-[10px] text-primary">{item.id}</span>{" "}
                    {item.title}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 font-mono text-[10px] text-muted-foreground">
                <span>{items.reduce((sum, i) => sum + (i.estimate_points || 0), 0)} pts</span>
                <span>{tests.length} test runs</span>
                <span>retries {sprint.retries}</span>
              </div>
            </Card>
          );
        })}
      </div>

      <div>
        <h4 className="mono-label mb-2">Product backlog</h4>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-xs">
            <thead className="bg-surface-raised">
              <tr className="text-left">
                <th className="px-3 py-2 font-mono font-normal text-muted-foreground">ID</th>
                <th className="px-3 py-2 font-mono font-normal text-muted-foreground">Item</th>
                <th className="px-3 py-2 font-mono font-normal text-muted-foreground">Stories</th>
                <th className="px-3 py-2 font-mono font-normal text-muted-foreground">Pts</th>
                <th className="px-3 py-2 font-mono font-normal text-muted-foreground">Depends on</th>
              </tr>
            </thead>
            <tbody>
              {state.backlog.map((item) => (
                <tr key={item.id} className="border-t border-border/60">
                  <td className="px-3 py-2 font-mono text-primary">{item.id}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.title}</div>
                    <div className="text-muted-foreground">{item.description}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {(item.story_ids ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono">{item.estimate_points}</td>
                  <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                    {(item.depends_on ?? []).join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

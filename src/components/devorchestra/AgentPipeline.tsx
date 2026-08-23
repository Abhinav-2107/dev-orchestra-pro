import { ChevronRight, CircleCheck, CircleDashed, CircleX, Loader2 } from "lucide-react";
import { PIPELINE_AGENTS } from "@/lib/devorchestra/pipeline";
import type { AgentStatus, RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<AgentStatus, string> = {
  pending: "border-border bg-surface text-muted-foreground",
  running: "border-primary bg-primary/10 text-primary shadow-glow",
  completed: "border-success/60 bg-success/10 text-success",
  failed: "border-destructive/70 bg-destructive/10 text-destructive",
};

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === "running") return <Loader2 className="size-3.5 animate-spin" />;
  if (status === "completed") return <CircleCheck className="size-3.5" />;
  if (status === "failed") return <CircleX className="size-3.5" />;
  return <CircleDashed className="size-3.5" />;
}

export function AgentPipeline({ state }: { state: RunState }) {
  const agents =
    state.mode === "baseline"
      ? [{ id: "baseline" as const, label: "Single LLM" }]
      : PIPELINE_AGENTS;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {agents.map((agent, index) => {
        const record = state.agents[agent.id];
        return (
          <div key={agent.id} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-md border px-3 py-2 transition-all",
                STATUS_STYLES[record?.status ?? "pending"],
              )}
            >
              <StatusIcon status={record?.status ?? "pending"} />
              <span className="font-mono text-xs">{agent.label}</span>
              {record?.durationMs ? (
                <span className="font-mono text-[10px] opacity-60">
                  {(record.durationMs / 1000).toFixed(1)}s
                </span>
              ) : null}
            </div>
            {index < agents.length - 1 && (
              <ChevronRight className="size-4 text-muted-foreground/50" />
            )}
          </div>
        );
      })}
    </div>
  );
}

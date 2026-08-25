import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { AGENT_PROMPTS } from "@/lib/devorchestra/prompts";
import type { AgentId, RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

const LEVEL: Record<string, string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warn: "text-warning",
  error: "text-destructive",
};

export function LogsView({ state }: { state: RunState }) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mono-label mb-2">Execution log</h4>
        <div className="scroll-slim max-h-80 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
          {state.logs.length === 0 ? (
            <span className="text-muted-foreground">No activity yet.</span>
          ) : (
            [...state.logs].reverse().map((entry, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-muted-foreground/60">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                <span className="text-primary">[{entry.agent}]</span>
                <span className={cn(LEVEL[entry.level])}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <h4 className="mono-label mb-2">Raw agent outputs</h4>
        <Accordion type="single" collapsible className="rounded-md border border-border">
          {(Object.keys(state.agents) as AgentId[])
            .filter((id) => state.agents[id]?.output || state.agents[id]?.error)
            .map((id) => (
              <AccordionItem key={id} value={id} className="px-3">
                <AccordionTrigger className="text-xs">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-primary">{id}</span>
                    <span className="text-muted-foreground">{AGENT_PROMPTS[id]?.title}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  {state.agents[id]?.error && (
                    <p className="mb-2 text-xs text-destructive">{state.agents[id]?.error}</p>
                  )}
                  <pre className="scroll-slim max-h-80 overflow-auto rounded border border-border bg-background p-3 text-[11px] leading-relaxed">
                    {JSON.stringify(state.agents[id]?.output ?? {}, null, 2)}
                  </pre>
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      </div>
    </div>
  );
}

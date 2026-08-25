import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { RunState } from "@/lib/devorchestra/types";

function plantUmlUrl(source: string) {
  // PlantUML server supports hex-encoded sources via the ~h prefix.
  const hex = Array.from(new TextEncoder().encode(source))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `https://www.plantuml.com/plantuml/svg/~h${hex}`;
}

export function ArchitectureView({ state }: { state: RunState }) {
  const [sprint, setSprint] = useState(0);
  const architectures = state.architectures;
  if (architectures.length === 0) {
    return <p className="text-sm text-muted-foreground">The Architecture Agent has not run yet.</p>;
  }
  const arch = architectures.find((a) => a.sprint === sprint) ?? architectures[0]!;
  const uml = (arch.plantuml ?? "").replace(/\\n/g, "\n");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {architectures.map((item) => (
          <Button
            key={item.sprint}
            size="sm"
            variant={item.sprint === arch.sprint ? "default" : "secondary"}
            onClick={() => setSprint(item.sprint)}
          >
            Sprint {item.sprint + 1}
          </Button>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{arch.overview}</p>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-2 p-4">
          <span className="mono-label">Frontend</span>
          <p className="font-mono text-xs text-primary">{arch.frontend?.stack}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {(arch.frontend?.components ?? []).map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Card>
        <Card className="gap-2 p-4">
          <span className="mono-label">Backend</span>
          <p className="font-mono text-xs text-primary">{arch.backend?.stack}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {(arch.backend?.services ?? []).map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Card>
        <Card className="gap-2 p-4">
          <span className="mono-label">Database</span>
          <p className="font-mono text-xs text-primary">{arch.database?.engine}</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {(arch.database?.tables ?? []).map((t) => (
              <li key={t.name}>
                <span className="text-foreground">{t.name}</span> ({(t.columns ?? []).join(", ")})
              </li>
            ))}
          </ul>
        </Card>
        <Card className="gap-2 p-4">
          <span className="mono-label">Dependencies</span>
          <div className="flex flex-wrap gap-1.5">
            {(arch.dependencies ?? []).map((d) => (
              <Badge key={d.name} variant="secondary" className="font-mono text-[10px]">
                {d.name}
              </Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card className="gap-2 p-4">
        <span className="mono-label">API surface</span>
        <ul className="space-y-1 font-mono text-xs">
          {(arch.apis ?? []).map((api) => (
            <li key={`${api.method}-${api.path}`} className="flex gap-2">
              <span className="text-accent">{api.method}</span>
              <span>{api.path}</span>
              <span className="text-muted-foreground">— {api.purpose}</span>
            </li>
          ))}
        </ul>
      </Card>

      {uml.trim() && (
        <Card className="gap-3 p-4">
          <div className="flex items-center justify-between">
            <span className="mono-label">PlantUML component diagram</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => navigator.clipboard.writeText(uml)}
            >
              Copy source
            </Button>
          </div>
          <div className="overflow-auto rounded border border-border bg-surface-raised p-3">
            <img
              src={plantUmlUrl(uml)}
              alt={`Architecture diagram for sprint ${arch.sprint + 1}`}
              loading="lazy"
              className="max-w-full"
            />
          </div>
          <pre className="scroll-slim max-h-64 overflow-auto rounded border border-border bg-background p-3 text-[11px] leading-relaxed text-muted-foreground">
            {uml}
          </pre>
        </Card>
      )}
    </div>
  );
}

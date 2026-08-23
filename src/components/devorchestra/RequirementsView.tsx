import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { RunState } from "@/lib/devorchestra/types";

export function RequirementsView({ state }: { state: RunState }) {
  const req = state.requirements;
  if (!req) {
    return <p className="text-sm text-muted-foreground">The Requirement Agent has not run yet.</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{req.project_summary}</p>

      <div className="grid gap-3 md:grid-cols-2">
        <Card className="gap-2 p-4">
          <span className="mono-label">Functional requirements</span>
          <ul className="space-y-1.5 text-xs">
            {(req.functional_requirements ?? []).map((item) => (
              <li key={item.id}>
                <span className="font-mono text-primary">{item.id}</span>{" "}
                <span className="font-medium">{item.title}</span>
                <div className="text-muted-foreground">{item.description}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="gap-2 p-4">
          <span className="mono-label">Non-functional requirements</span>
          <ul className="space-y-1.5 text-xs">
            {(req.non_functional_requirements ?? []).map((item) => (
              <li key={item.id}>
                <span className="font-mono text-accent">{item.id}</span>{" "}
                <span className="font-medium">{item.title}</span>
                <div className="text-muted-foreground">{item.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div>
        <h4 className="mono-label mb-2">Modules</h4>
        <div className="flex flex-wrap gap-2">
          {(req.modules ?? []).map((module) => (
            <Badge key={module.name} variant="secondary" className="font-mono text-[10px]">
              {module.name}
            </Badge>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mono-label mb-2">User stories & acceptance criteria</h4>
        <div className="grid gap-3 md:grid-cols-2">
          {(req.user_stories ?? []).map((story) => (
            <Card key={story.id} className="gap-2 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-primary">{story.id}</span>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {story.priority}
                </Badge>
              </div>
              <p className="text-xs">
                As <span className="font-medium">{story.as_a}</span>, I want {story.i_want} so that{" "}
                {story.so_that}.
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {(story.acceptance_criteria ?? []).map((criterion) => (
                  <li key={criterion} className="flex gap-2">
                    <span className="text-primary">▸</span>
                    {criterion}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

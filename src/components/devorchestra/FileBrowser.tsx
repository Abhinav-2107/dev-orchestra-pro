import { useMemo, useState } from "react";
import { Download, File as FileIcon, FolderDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { RunState } from "@/lib/devorchestra/types";
import { cn } from "@/lib/utils";

type DirHandle = {
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<DirHandle>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean },
  ) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }>;
  name: string;
};

function manifest(state: RunState) {
  return JSON.stringify(
    {
      name: state.name,
      requirement: state.requirement,
      mode: state.mode,
      provider: state.providerLabel,
      model: state.model,
      requirements: state.requirements,
      backlog: state.backlog,
      sprints: state.sprints,
      architectures: state.architectures,
      reviews: state.reviews,
      tests: state.tests,
      corrections: state.corrections,
      logs: state.logs,
    },
    null,
    2,
  );
}

function hasDirectoryPicker() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function saveToFolder(state: RunState) {
  try {
    const picker = (window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<DirHandle> })
      .showDirectoryPicker;
    const root = await picker({ mode: "readwrite" });

    const dirCache = new Map<string, DirHandle>([["", root]]);
    const ensureDir = async (dirPath: string): Promise<DirHandle> => {
      if (dirCache.has(dirPath)) return dirCache.get(dirPath)!;
      const parts = dirPath.split("/").filter(Boolean);
      let current = root;
      let walked = "";
      for (const part of parts) {
        walked = walked ? `${walked}/${part}` : part;
        const cached = dirCache.get(walked);
        current = cached ?? (await current.getDirectoryHandle(part, { create: true }));
        dirCache.set(walked, current);
      }
      return current;
    };

    const writeFile = async (path: string, content: string) => {
      const segments = path.split("/").filter(Boolean);
      const fileName = segments.pop()!;
      const dir = await ensureDir(segments.join("/"));
      const handle = await dir.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    };

    for (const file of state.files) await writeFile(file.path, file.content);
    await writeFile("DEVORCHESTRA.json", manifest(state));

    toast.success(`Saved ${state.files.length + 1} files into "${root.name}".`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const blocked =
      error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotAllowedError");
    toast.error(
      blocked
        ? "Saving into a folder is blocked inside this embedded preview. Open the app in its own browser tab to use it — downloading a zip for now."
        : "Could not write to that folder. Downloading a zip instead.",
    );
    await exportZip(state);
  }
}


async function exportZip(state: RunState) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of state.files) zip.file(file.path, file.content);
  zip.file("DEVORCHESTRA.json", manifest(state));
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.name.replace(/\s+/g, "-").toLowerCase()}-devorchestra.zip`;
  link.click();
  URL.revokeObjectURL(url);
  toast.success("Project exported.");
}


export function FileBrowser({ state }: { state: RunState }) {
  const [selected, setSelected] = useState<string | null>(null);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof state.files>();
    for (const file of state.files) {
      const dir = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : "root";
      map.set(dir, [...(map.get(dir) ?? []), file]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [state.files]);

  const active = state.files.find((f) => f.path === selected) ?? state.files[0];

  if (state.files.length === 0) {
    return <p className="text-sm text-muted-foreground">No files generated yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="mono-label">
          {state.files.length} files · {state.files.reduce((n, f) => n + f.content.length, 0)} bytes
        </span>
        <div className="flex items-center gap-2">
          {hasDirectoryPicker() && (
            <Button size="sm" onClick={() => saveToFolder(state)}>
              <FolderDown /> Save to folder
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => exportZip(state)}>
            <Download /> Export zip
          </Button>
        </div>

      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
        <div className="scroll-slim max-h-[520px] overflow-auto rounded-md border border-border bg-surface p-2">
          {grouped.map(([dir, files]) => (
            <div key={dir} className="mb-2">
              <div className="mono-label px-1 py-1">{dir}</div>
              {files.map((file) => (
                <button
                  key={file.path}
                  onClick={() => setSelected(file.path)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors hover:bg-surface-raised",
                    active?.path === file.path && "bg-primary/10 text-primary",
                  )}
                >
                  <FileIcon className="size-3 shrink-0" />
                  <span className="truncate">{file.path.split("/").pop()}</span>
                  {file.revision > 1 && (
                    <Badge variant="secondary" className="ml-auto font-mono text-[9px]">
                      r{file.revision}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="flex items-center justify-between border-b border-border bg-surface-raised px-3 py-2">
            <span className="font-mono text-[11px]">{active?.path}</span>
            <span className="mono-label">
              {active?.language} · sprint {(active?.sprint ?? 0) + 1}
            </span>
          </div>
          <pre className="scroll-slim max-h-[470px] overflow-auto p-4 text-[11px] leading-relaxed">
            {active?.content}
          </pre>
        </div>
      </div>
    </div>
  );
}

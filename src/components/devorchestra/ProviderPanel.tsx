import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { testProviderFn } from "@/lib/devorchestra.functions";
import type { ProviderConfig, ProviderMode } from "@/lib/devorchestra/types";
import { LOVABLE_MODELS, normalizeLovableModel } from "@/lib/devorchestra/types";

const API_MODEL_HINTS: Record<string, string> = {
  openai: "gpt-4o-mini",
  google: "gemini-2.0-flash",
  anthropic: "claude-3-5-sonnet-latest",
  custom: "model-name",
};

export function ProviderPanel({
  config,
  onChange,
}: {
  config: ProviderConfig;
  onChange: (config: ProviderConfig) => void;
}) {
  const [testing, setTesting] = useState(false);
  const testProvider = useServerFn(testProviderFn);

  const set = <K extends keyof ProviderConfig>(key: K, value: ProviderConfig[K]) =>
    onChange({ ...config, [key]: value });

  async function runTest() {
    setTesting(true);
    try {
      const result = (await testProvider({ data: { config } })) as {
        ok: boolean;
        message: string;
      };
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Tabs value={config.mode} onValueChange={(value) => set("mode", value as ProviderMode)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="lovable">Lovable AI</TabsTrigger>
          <TabsTrigger value="api">API model</TabsTrigger>
          <TabsTrigger value="ollama">Ollama</TabsTrigger>
        </TabsList>
      </Tabs>

      {config.mode === "lovable" && (
        <div className="space-y-2">
          <Label className="mono-label">Model</Label>
          <Select value={config.model} onValueChange={(value) => set("model", value)}>
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LOVABLE_MODELS.map((model) => (
                <SelectItem key={model} value={model} className="font-mono text-xs">
                  {model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Built-in gateway — no key needed. Every agent uses this model.
          </p>
        </div>
      )}

      {config.mode === "api" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="mono-label">Provider</Label>
            <Select
              value={config.apiProvider}
              onValueChange={(value) =>
                onChange({
                  ...config,
                  apiProvider: value as ProviderConfig["apiProvider"],
                  model: API_MODEL_HINTS[value] ?? config.model,
                })
              }
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="google">Google Gemini</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="custom">Custom (OpenAI-compatible)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="mono-label">API key</Label>
            <Input
              type="password"
              value={config.apiKey}
              placeholder="sk-..."
              onChange={(event) => set("apiKey", event.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Kept in this browser session only — sent per request, never stored.
            </p>
          </div>
          <div className="space-y-2">
            <Label className="mono-label">Model</Label>
            <Input
              value={config.model}
              onChange={(event) => set("model", event.target.value)}
              placeholder={API_MODEL_HINTS[config.apiProvider]}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label className="mono-label">Base URL (optional)</Label>
            <Input
              value={config.baseUrl}
              onChange={(event) => set("baseUrl", event.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-xs"
            />
          </div>
        </div>
      )}

      {config.mode === "ollama" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="mono-label">Ollama base URL</Label>
            <Input
              value={config.ollamaBaseUrl}
              onChange={(event) => set("ollamaBaseUrl", event.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-2">
            <Label className="mono-label">Model</Label>
            <Input
              value={config.ollamaModel}
              onChange={(event) => set("ollamaModel", event.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Ollama runs on your machine, so a hosted preview cannot reach it. Run DevOrchestra
            locally to drive the whole workflow through qwen2.5:14b.
          </p>
        </div>
      )}

      <Button variant="secondary" className="w-full" onClick={runTest} disabled={testing}>
        {testing ? (
          <Loader2 className="animate-spin" />
        ) : (
          <PlugZap />
        )}
        Test connection
      </Button>
    </div>
  );
}

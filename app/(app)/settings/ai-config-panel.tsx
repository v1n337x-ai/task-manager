"use client";

import * as React from "react";
import { useTransition } from "react";
import { KeyRound, PlugZap, Save, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { formatDateTime } from "@/lib/utils";
import type { AiConfigSafeDTO } from "@/lib/services/ai-config-service";
import type { AiProviderMetadata } from "@/lib/ai/provider-registry";

const selectClass = "w-full rounded-lg border border-stroke bg-card px-3 py-2 text-[14px]";

/**
 * AI Configuration panel (Phase 2.1 §3):
 * - provider select (OpenCode today; registry drives future options)
 * - password input that is NEVER prefilled from the server
 * - honest status ("Configured" / "Not configured") with masked hint
 * - Save (empty input preserves the stored key), Test Connection (server-side,
 *   honest result), Remove key (confirmation-gated)
 */
export function AiConfigPanel({
  initial,
  providers,
}: {
  initial: AiConfigSafeDTO & { providers?: AiProviderMetadata[] };
  providers: AiProviderMetadata[];
}) {
  const [config, setConfig] = React.useState(initial);
  const [apiKeyInput, setApiKeyInput] = React.useState("");
  const [message, setMessage] = React.useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = React.useState(false);

  const withCsrf = async (init: RequestInit = {}): Promise<RequestInit> => {
    const csrf = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("tm_csrf="))
      ?.split("=")
      .slice(1)
      .join("=");
    return {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        "Content-Type": "application/json",
      },
    };
  };

  async function handleSave() {
    setBusy(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = {
        action: "SAVE",
        provider: config.provider,
        enabled: config.enabled,
      };
      if (apiKeyInput.trim().length > 0) payload.apiKey = apiKeyInput.trim();
      const res = await fetch("/api/settings/ai", await withCsrf({ method: "POST", body: JSON.stringify(payload) }));
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error?.message ?? "Save failed." });
      } else {
        setConfig(data);
        setApiKeyInput("");
        setMessage({
          kind: "ok",
          text: payload.apiKey ? "API key stored securely (encrypted at rest)." : "Configuration saved. The existing key is preserved.",
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveKey() {
    setBusy(true);
    try {
      const res = await fetch(
        "/api/settings/ai",
        await withCsrf({ method: "POST", body: JSON.stringify({ action: "CLEAR_KEY", provider: config.provider }) }),
      );
      const data = await res.json();
      if (!res.ok) setMessage({ kind: "error", text: data.error?.message ?? "Removal failed." });
      else {
        setConfig(data);
        setMessage({ kind: "info", text: "Stored API key removed." });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(
        "/api/settings/ai/test",
        await withCsrf({ method: "POST", body: JSON.stringify({ provider: config.provider }) }),
      );
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: data.error?.message ?? "Connection test could not run." });
        return;
      }
      setConfig(data);
      const status = data.test?.status as string | undefined;
      const text = data.test?.message as string | undefined;
      if (status === "PASSED") setMessage({ kind: "ok", text: text ?? "Connection test passed." });
      else if (status === "FAILED") setMessage({ kind: "error", text: text ?? "Connection test failed." });
      else setMessage({ kind: "info", text: text ?? "Connection test unavailable." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink">AI Configuration</h2>
          <p className="mt-1 text-[13px] text-muted">
            Provider used by future VAPT email and finding analysis. The key is encrypted at rest and never exposed to the browser.
          </p>
        </div>
        {config.configured ? (
          <Badge variant="good">Configured</Badge>
        ) : (
          <Badge variant="muted">Not configured</Badge>
        )}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ai-provider">Provider</Label>
          <select
            id="ai-provider"
            value={config.provider}
            onChange={(e) => setConfig((c) => ({ ...c, provider: e.target.value }))}
            className={selectClass}
          >
            {providers.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ai-apikey">API Key</Label>
          <Input
            id="ai-apikey"
            type="password"
            autoComplete="off"
            placeholder={config.configured ? `${config.apiKeyHint ?? "••••••••"} — stored (no reveal)` : "paste API key…"}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            aria-describedby="ai-key-help"
          />
          <p id="ai-key-help" className="mt-1 text-[12px] text-muted">
            {config.configured
              ? "A key is stored. Enter a new key only to replace it — leave empty to keep it. There is no reveal."
              : "No key stored yet. It will be encrypted (AES-256-GCM) before storage."}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-muted">Last test</dt>
          <dd className="text-ink-2">{config.lastTestedAt ? formatDateTime(config.lastTestedAt) : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Test status</dt>
          <dd>
            <TestStatusBadge status={config.lastTestStatus} />
          </dd>
        </div>
      </dl>
      {config.lastTestMessage ? <p className="mt-2 text-[12px] text-muted-2">{config.lastTestMessage}</p> : null}

      {message ? (
        <p
          role="status"
          className={
            "mt-3 rounded-md border px-3 py-2 text-[13px] " +
            (message.kind === "error"
              ? "border-accent/30 bg-accent/5 text-accent"
              : message.kind === "ok"
                ? "border-good/30 bg-good/5 text-good"
                : "border-stroke bg-band text-muted-2")
          }
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" type="button" onClick={handleTest} disabled={busy || pending}>
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />}
          Test Connection
        </Button>
        <Button
          variant="accent"
          type="button"
          onClick={handleSave}
          disabled={busy || pending}
          data-testid="ai-save"
        >
          <Save className="h-4 w-4" aria-hidden /> Save
        </Button>
        {config.configured ? (
          <Button variant="ghost" type="button" onClick={() => setConfirmClear(true)} disabled={busy || pending}>
            <Trash2 className="h-4 w-4" aria-hidden /> Remove key
          </Button>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted">
          <KeyRound className="h-3.5 w-3.5" aria-hidden /> encryption: APP_ENCRYPTION_KEY · AES-256-GCM
        </span>
      </div>

      <ConfirmationDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Remove the stored API key?"
        description="The encrypted key is deleted from the database. Not configured until you save a new key."
        confirmLabel="Remove key"
        pending={busy}
        onConfirm={() => startTransition(() => void handleRemoveKey())}
      />
    </div>
  );
}

function TestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: "good" | "critical" | "info" | "muted"; label: string }> = {
    NOT_TESTED: { variant: "muted", label: "Not tested" },
    PASSED: { variant: "good", label: "Passed" },
    FAILED: { variant: "critical", label: "Failed" },
    UNAVAILABLE: { variant: "info", label: "Test unavailable" },
  };
  const v = map[status] ?? { variant: "muted" as const, label: status };
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

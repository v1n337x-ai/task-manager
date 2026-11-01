"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, Loader2 } from "lucide-react";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

interface DecisionRow {
  id: number;
  entityType: string;
  entityId: number;
  iterationNumber: number | null;
  previousState: string | null;
  newState: string;
  verification: string | null;
  decisionSource: string;
  resolutionMethod: string;
  sourceMessageId: number | null;
  approvedByUserId: number | null;
  approvedAt: string | null;
  reason: string | null;
}

/**
 * Iteration/state review (Phase 6 §27-§29/§58): authoritative decisions ledger,
 * state-history timeline per finding, correction entry with mandatory reason.
 */
export function StateReviewPanel({ applicationId }: { applicationId: number }) {
  const [decisions, setDecisions] = React.useState<DecisionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [entityId, setEntityId] = React.useState("");
  const [newState, setNewState] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [lastMsg, setLastMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/authoritative-state/review?applicationId=${applicationId}`);
      const data = await res.json();
      if (res.ok) setDecisions(data.decisions);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function correct() {
    if (!entityId || !newState || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const res = await fetch("/api/authoritative-state/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
        body: JSON.stringify({ entityType: "finding", entityId: Number(entityId), newState, reason: reason.trim(), resolutionMethod: "HUMAN_CORRECTION" }),
      });
      const data = await res.json();
      setLastMsg(res.ok ? `Human correction recorded (decision #${data.decisionId}, created: ${data.created}). Prior states preserved.` : (data.error?.message ?? "Correction failed."));
      if (res.ok) {
        setEntityId("");
        setNewState("");
        setReason("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Authoritative state decisions" className="panel px-5 py-4">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-muted" aria-hidden />
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink">Authoritative state decisions (append-only)</h3>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Human corrections always take precedence; AI-derived state only after approval; nothing historical is overwritten.
      </p>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading decisions…</p>
      ) : decisions.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">No authoritative decisions recorded for this application yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-lg border border-stroke px-3 py-2 text-[13px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {d.entityType}#{d.entityId} → {d.newState}
                  {d.verification && d.verification !== "NONE" ? <Badge variant="info" className="ml-2">{d.verification.replace("_", " ").toLowerCase()}</Badge> : null}
                </span>
                <span className="text-[11px] text-muted">{d.approvedAt ? new Date(d.approvedAt).toLocaleString("en-GB") : ""}</span>
              </div>
              <p className="text-[12px] text-muted">
                {d.previousState ? `${d.previousState} → ` : ""}{d.newState} · source: {d.decisionSource.toLowerCase()} · {d.resolutionMethod.toLowerCase().replace(/_/g, " ")}
                {d.iterationNumber ? ` · I${d.iterationNumber}` : ""}
              </p>
              {d.reason ? <p className="text-[12px] text-muted-2">reason: {d.reason}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-2">Record a human correction (HIVELP override)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Input placeholder="Finding ID (number)" value={entityId} onChange={(e) => setEntityId(e.target.value)} type="number" aria-label="Finding ID" />
          <Input placeholder="New state (e.g. not_fixed)" value={newState} onChange={(e) => setNewState(e.target.value)} aria-label="New state" />
          <Input placeholder="Reason (required, min 3 chars) — preserved forever" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
        </div>
        <Button size="sm" variant="accent" className="mt-2" onClick={correct} disabled={busy || !entityId || !newState || reason.trim().length < 3} data-testid="state-correct">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null} Record correction
        </Button>
      </details>

      {lastMsg ? <p role="status" className="mt-3 rounded-md border border-stroke bg-band px-3 py-2 text-[13px] text-ink-2">{lastMsg}</p> : null}
    </section>
  );
}

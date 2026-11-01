"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ChevronsUpDown, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";

interface StructuredExtraction {
  schemaVersion: string;
  threadSummary: string;
  participants: { email: string; proposedRole: string; roleBasis: string; confidence: string; evidence: { messageIndex: number; excerpt: string }[] }[];
  findings: { identifierExplicit: string | null; identifierMark: string; title: string; titleMark: string; severity: string; severityMark: string; statusSignal: string | null; evidence: { messageIndex: number; excerpt: string }[] }[];
  testCases: { title: string; stateSignal: string | null; evidence: { messageIndex: number; excerpt: string }[] }[];
  iterationSignals: { candidateIteration: number | null; typeSignal?: string; explicitOrInferred: string; confidence: string; evidence: { messageIndex: number; excerpt: string }[] }[];
}

interface EvidenceRow {
  id: number;
  field: string;
  extractedValue: string;
  excerpt: string | null;
  confidence: number | null;
  sourceId: number;
  sourceType: string;
}

interface ReviewExtraction {
  id: number;
  threadId: number | null;
  providerSlug: string | null;
  schemaVersion: string | null;
  promptVersion: string | null;
  inputContextHash: string | null;
  statusValue: string;
  confidence: number | null;
  errorMessage: string | null;
  createdAt: string;
  structured: StructuredExtraction | null;
  evidence: EvidenceRow[];
}

/**
 * AI Review (Phase 5 §40-§44, §67-§76): side-by-side extraction + evidence.
 * Item-level approve/reject/correct — the AI payload is never mutated.
 */
export function AiReview({ threadId, threadSubject }: { threadId: number; threadSubject: string }) {
  const [runs, setRuns] = React.useState<{ id: number; createdAt: string; statusValue: string; providerSlug: string | null }[]>([]);
  const [extraction, setExtraction] = React.useState<ReviewExtraction | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [busyItem, setBusyItem] = React.useState<string | null>(null);
  const [lastMsg, setLastMsg] = React.useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = React.useState<string | null>(null);

  const [correctionValue, setCorrectionValue] = React.useState("");

  const refreshRuns = React.useCallback(async () => {
    const res = await fetch(`/api/ai/threads/${threadId}/extractions`);
    const data = await res.json();
    if (res.ok) setRuns(data.runs);
  }, [threadId]);

  const loadExtraction = React.useCallback(async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/extractions/${id}`);
      const data = await res.json();
      if (res.ok) setExtraction(data);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refreshRuns();
  }, [refreshRuns]);

  async function analyze() {
    setBusy(true);
    setLastMsg(null);
    try {
      const csrf = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="))?.split("=").slice(1).join("");
      const res = await fetch("/api/ai/analyze/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}), "x-ai-provider-override": "mock" },
        body: JSON.stringify({ threadId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLastMsg(data.error?.message ?? "Analysis failed.");
        return;
      }
      setLastMsg(`AI analysis completed — extraction #${data.extractionId} (provider: ${data.provider}, schema: ${data.schemaVersion}).`);
      await refreshRuns();
      await loadExtraction(data.extractionId);
    } finally {
      setBusy(false);
    }
  }

  async function reanalyze() {
    if (!extraction) return;
    setBusy(true);
    try {
      const csrf = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="))?.split("=").slice(1).join("");
      const res = await fetch(`/api/ai/extractions/${extraction.id}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}), "x-ai-provider-override": "mock" },
        body: JSON.stringify({ threadId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLastMsg(data.error?.message ?? "Re-analysis failed.");
        return;
      }
      setLastMsg(`Re-analysis created extraction #${data.newExtractionId}. Previous run preserved.`);
      await refreshRuns();
      await loadExtraction(data.newExtractionId);
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject" | "correct", itemKey: string | null, correctedValue?: unknown) {
    if (!extraction) return;
    setBusyItem(itemKey ?? "run");
    try {
      const csrf = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="))?.split("=").slice(1).join("");
      const endpoint = decision === "correct" ? "correct" : decision === "reject" ? "reject" : "approve";
      const res = await fetch(`/api/ai/extractions/${extraction.id}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
        body: JSON.stringify({ extractionId: extraction.id, decision, itemKey: itemKey ?? undefined, correctedValue }),
      });
      const data = await res.json();
      setLastMsg(res.ok ? `Decision recorded (${decision}${itemKey ? `, ${itemKey}` : ", whole run"}). The AI payload is preserved unchanged.` : (data.error?.message ?? "Decision failed."));
      await loadExtraction(extraction.id);
      await refreshRuns();
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <section aria-label="AI Review" className="panel px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink">
          AI Review — {threadSubject}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="accent" onClick={analyze} disabled={busy} data-testid="analyze-thread">
            <Sparkles className="h-4 w-4" aria-hidden /> {busy ? "Analyzing…" : "Analyze Thread"}
          </Button>
          {runs.length > 0 ? (
            <Button variant="outline" onClick={reanalyze} disabled={busy}>
              Re-analyze
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-muted">
        Explicitly user-triggered · structured AI_EXTRACTION_V1 · every claim needs evidence · nothing mutates VAPT state until human approval (and Phase 6 wiring).
      </p>
      <p className="mt-2 text-[12px] text-muted-2">Current OpenCode mode: deterministic analysis unavailable until the provider contract is supplied — runs in this workspace use the deterministic mock provider.</p>

      {lastMsg ? <p role="status" className="mt-3 rounded-md border border-stroke bg-band px-3 py-2 text-[13px] text-ink-2">{lastMsg}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ChevronsUpDown className="h-4 w-4 text-muted" aria-hidden />
        {runs.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => loadExtraction(r.id)}
            className={cn("rounded-md border px-2 py-1 text-[12px]", extraction?.id === r.id ? "border-accent bg-accent/10 text-accent" : "border-stroke text-ink-2 hover:bg-band")}
          >
            Run #{r.id} · {r.statusValue} · {new Date(r.createdAt).toLocaleDateString("en-GB")}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading extraction…</p>
      ) : !extraction ? (
        <p className="mt-4 text-[13px] text-muted">No extraction selected — run &quot;Analyze Thread&quot; first.</p>
      ) : extraction.errorMessage ? (
        <p role="alert" className="mt-4 rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[13px] text-accent">{extraction.errorMessage}</p>
      ) : !extraction.structured ? (
        <p className="mt-4 text-[13px] text-muted">Extraction stored without structured output.</p>
      ) : (
        <div className="mt-4 space-y-5">
          <div>
            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Thread summary (AI)</h4>
            <p className="mt-1 rounded-md border border-stroke bg-band px-3 py-2 text-[13px] text-ink-2">{extraction.structured.threadSummary}</p>
            <MetaLine
              provider={extraction.providerSlug}
              schema={extraction.schemaVersion}
              prompt={extraction.promptVersion}
              hash={extraction.inputContextHash}
              confidence={extraction.confidence}
            />
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => decide("approve", null)} disabled={busy !== false}>
                <Gavel className="h-3.5 w-3.5" aria-hidden /> Approve summary
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide("reject", null)} disabled={busy !== false}>
                Reject summary
              </Button>
            </div>
          </div>

          <ReviewBlock
            title="Participants & proposed roles"
            items={extraction.structured.participants.map((p, i) => ({
              key: `participantRole:${p.email}#${i}`,
              main: `${p.email}`,
              sub: `AI proposed role: ${p.proposedRole} · ${p.roleBasis} · confidence ${p.confidence}`,
              evidence: p.evidence.map((e) => ({ messageIndex: e.messageIndex, excerpt: e.excerpt })),
              correctPlaceholder: "Corrected role (e.g. pentester / developer / application_owner / other / unknown)",
            }))}
            busyItem={busyItem}
            onApprove={(key) => decide("approve", key)}
            onReject={(key) => decide("reject", key)}
            onCorrect={(key, value) => decide("correct", key, value)}
            correctionValue={correctionValue}
            setCorrectionValue={setCorrectionValue}
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
          />

          <ReviewBlock
            title="Finding candidates"
            items={extraction.structured.findings.map((f, i) => ({
              key: `findingStatus:${i}`,
              main: `${f.identifierMark === "IDENTIFIER_EXPLICIT" ? `${f.identifierExplicit} (explicit ID)` : f.identifierMark === "AI_PROPOSED" ? `${f.title} (AI proposed)` : f.title}`,
              sub: `severity ${f.severity} (${f.severityMark}) · status ${f.statusSignal ?? "—"} · evidence ${f.evidence.length}`,
              evidence: f.evidence.map((e) => ({ messageIndex: e.messageIndex, excerpt: e.excerpt })),
              correctPlaceholder: "Corrected status (fixed / not_fixed / open / …)",
            }))}
            busyItem={busyItem}
            onApprove={(key) => decide("approve", key)}
            onReject={(key) => decide("reject", key)}
            onCorrect={(key, value) => decide("correct", key, value)}
            correctionValue={correctionValue}
            setCorrectionValue={setCorrectionValue}
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
          />

          <ReviewBlock
            title="Iteration signals"
            items={extraction.structured.iterationSignals.map((s, i) => ({
              key: `iterationSignal:${i}`,
              main: `Iteration candidate: ${s.candidateIteration ?? "—"} (${s.typeSignal ?? "?"})`,
              sub: `${s.explicitOrInferred} · confidence ${s.confidence}`,
              evidence: s.evidence.map((e) => ({ messageIndex: e.messageIndex, excerpt: e.excerpt })),
              correctPlaceholder: "Corrected iteration number",
            }))}
            busyItem={busyItem}
            onApprove={(key) => decide("approve", key)}
            onReject={(key) => decide("reject", key)}
            onCorrect={(key, value) => decide("correct", key, value)}
            correctionValue={correctionValue}
            setCorrectionValue={setCorrectionValue}
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
          />
        </div>
      )}
    </section>
  );
}

type ReviewItem = { key: string; main: string; sub: string; evidence: { messageIndex: number; excerpt: string }[]; correctPlaceholder: string };

function ReviewBlock({
  title,
  items,
  busyItem,
  onApprove,
  onReject,
  onCorrect,
  correctionValue,
  setCorrectionValue,
  openEvidence,
  setOpenEvidence,
}: {
  title: string;
  items: ReviewItem[];
  busyItem: string | null;
  onApprove: (itemKey: string) => void;
  onReject: (itemKey: string) => void;
  onCorrect: (itemKey: string, value: unknown) => void;
  correctionValue: string;
  setCorrectionValue: (v: string) => void;
  openEvidence: string | null;
  setOpenEvidence: (v: string | null) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="panel px-4 py-3">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
        <p className="mt-1 text-[13px] text-muted">No items extracted for this category.</p>
      </div>
    );
  }
  return (
    <div className="panel px-4 py-3">
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <ul className="mt-2 space-y-3">
    {items.map((item) => (
          <li key={item.key} className="rounded-lg border border-stroke px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[14px] font-medium text-ink">{item.main}</p>
                <p className="text-[12px] text-muted">{item.sub}</p>
              </div>
              <Badge variant="info">AI Proposed</Badge>
            </div>

            <button
              type="button"
              onClick={() => setOpenEvidence(openEvidence === item.key ? null : item.key)}
              className="mt-1 text-[12px] text-progress underline-offset-2 hover:underline"
            >
              {openEvidence === item.key ? "Hide evidence" : `Evidence (${item.evidence.length})`}
            </button>
            {openEvidence === item.key ? (
              <ul className="mt-1 space-y-1 rounded-md bg-tint-b px-3 py-2 text-[12px]">
                {item.evidence.map((e, i) => (
                  <li key={i} className="text-ink-2">
                    <span className="text-muted">message #{e.messageIndex}: </span>“{e.excerpt.slice(0, 220)}”
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => onApprove(item.key)} disabled={busyItem === item.key}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onReject(item.key)} disabled={busyItem === item.key}>
                Reject
              </Button>
              <input
                className="rounded-md border border-stroke px-2 py-1 text-[12px]"
                placeholder={item.correctPlaceholder}
                value={correctionValue}
                onChange={(e) => setCorrectionValue(e.target.value)}
                aria-label={`Correction for ${item.key}`}
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onCorrect(item.key, correctionValue)}
                disabled={busyItem === item.key || !correctionValue}
              >
                Correct
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">Approving an item does not mutate VAPT data — authoritative application is a later, separately approved workflow.</p>
    </div>
  );
}

function MetaLine({ provider, schema, prompt, hash, confidence }: { provider: string | null; schema: string | null; prompt: string | null; hash: string | null; confidence: number | null }) {
  return (
    <p className="mt-1 text-[11px] text-muted">
      provider: {provider ?? "—"} · schema: {schema ?? "—"} · prompt: {prompt ?? "—"} · context hash: {(hash ?? "").slice(0, 16)} · confidence: {confidence ?? "—"}
    </p>
  );
}

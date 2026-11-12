"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, ChevronsUpDown, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateFindingCandidate } from "@/lib/ai/finding-quality";

interface StructuredExtraction {
  schemaVersion: string;
  threadSummary: string;
  participants: { email: string; proposedRole: string; roleBasis: string; confidence: string; evidence: { messageIndex: number; excerpt: string }[] }[];
  findings: { identifierExplicit: string | null; identifierMark: string; title: string; titleMark: string; severity: string; severityMark: string; statusSignal: string | null; evidence: { messageIndex: number; excerpt: string }[] }[];
  testCases: { title: string; stateSignal: string | null; evidence: { messageIndex: number; excerpt: string }[] }[];
  iterationSignals: { candidateIteration: number | null; typeSignal?: string; explicitOrInferred: string; confidence: string; evidence: { messageIndex: number; excerpt: string }[] }[];
  engagementRecord?: {
    mailSubject?: string | null;
    requestedDate?: string | null;
    scanReportDate?: string | null;
    iteration1Date?: string | null;
    iteration2Date?: string | null;
    iteration1Status?: string | null;
    iteration2Status?: string | null;
    comments?: string | null;
    followUpDate?: string | null;
    followUpResponse?: string | null;
    primaryPoc?: string | null;
    assignedMembers?: string | null;
    evidence: { messageIndex: number; excerpt: string }[];
  } | null;
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

interface ItemDecisionData {
  itemKey: string;
  decision: string;
  correctedValue: unknown;
  note?: string | null;
  decidedAt?: string | null;
}

interface RunDecisionData {
  decision: string;
  decidedAt: string;
  decidedByUserId: number;
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
  const [itemDecisions, setItemDecisions] = React.useState<ItemDecisionData[]>([]);
  const [runDecision, setRunDecision] = React.useState<RunDecisionData | null>(null);



  const extractionRef = React.useRef<ReviewExtraction | null>(null);
  React.useEffect(() => { extractionRef.current = extraction; }, [extraction]);
  React.useEffect(() => {
    setRuns([]);
    setExtraction(null);
    setItemDecisions([]);
    setRunDecision(null);
    setLastMsg(null);
    setOpenEvidence(null);
  }, [threadId]);
  const refreshRuns = React.useCallback(async () => {
    const res = await fetch(`/api/ai/threads/${threadId}/extractions`);
    const data = await res.json();
    if (res.ok) {
      setRuns(data.runs);
      const current = extractionRef.current;
      const needsBetter = !current || current.threadId !== threadId || !current.structured || !!current.errorMessage;
      if (data.runs?.length && needsBetter) {
        const latest = data.runs.find((r: { statusValue: string }) => r.statusValue !== "failed") ?? data.runs[0];
        if (latest && latest.id !== current?.id) {
          setLoading(true);
          try {
            const r = await fetch(`/api/ai/extractions/${latest.id}`);
            const d = await r.json();
            if (r.ok) setExtraction({ ...(d.extraction ?? {}), evidence: d.evidence ?? [] });
          } finally {
            setLoading(false);
          }
        }
      }
    }
  }, [threadId]);

  const loadExtraction = React.useCallback(async (id: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/extractions/${id}`);
      const data = await res.json();
      if (res.ok) {
        // API returns { extraction, evidence, itemDecisions, runDecision };
        // flatten so the panel can read fields directly.
        setExtraction({ ...(data.extraction ?? {}), evidence: data.evidence ?? [] });
        setItemDecisions(data.itemDecisions ?? []);
        setRunDecision(data.runDecision ?? null);
      }
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
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
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
        headers: { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) },
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
      const blockedItems = (data.result?.failed as Array<{ itemKey: string; reason: string }> | undefined) ?? [];
      const blockedSuffix = blockedItems.length ? ` ${blockedItems.length} candidate(s) were blocked by the quality gate: ${blockedItems.map((item) => `${item.itemKey} — ${item.reason}`).join("; ")}` : "";
      setLastMsg(res.ok ? `Decision recorded (${decision}${itemKey ? `, ${itemKey}` : ", whole run"}). The AI payload is preserved unchanged.${blockedSuffix}` : (data.error?.message ?? "Decision failed."));
      // Refetch so applied decisions/roles/record fields show immediately.
      if (res.ok) await loadExtraction(extraction.id);
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
      <p className="mt-1 text-[13px] leading-relaxed text-muted">
        AI creates evidence-backed candidates only. It never writes a finding by itself. Review each item, then approve what is correct; approved findings are written to the tracker, rejected candidates are not. Raw AI output is never changed.
      </p>

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
        <div role="alert" className="mt-4 space-y-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger"><p>{extraction.errorMessage}</p><p className="text-[12px] text-danger/80">This run did not produce reviewable output. Click &quot;Re-analyze&quot; above to retry — the previous run is preserved.</p></div>
      ) : !extraction.structured ? (
        <p className="mt-4 text-[13px] text-muted">This run has no reviewable output yet. Click &quot;Re-analyze&quot; to generate one.</p>
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
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => decide("approve", null)} disabled={busyItem !== null || !!runDecision}>
                <Gavel className="h-3.5 w-3.5" aria-hidden /> Approve all candidates in this run
              </Button>
              <Button size="sm" variant="ghost" onClick={() => decide("reject", null)} disabled={busyItem !== null || !!runDecision}>
                Reject all
              </Button>
              {runDecision ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent-deep">
                  Already reviewed: {runDecision.decision}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[12px] text-muted">Whole-run approval applies every valid finding candidate from this AI run.</p>
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
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
            decisionsByKey={new Map(itemDecisions.map((d) => [d.itemKey, d]))}
            footer="Approving a role applies it to the participant (promotes UNKNOWN; your human override always wins). Rejecting records the decision without changes. Correcting sets the role you type."
          />

          <ReviewBlock
            title="Finding candidates"
            items={extraction.structured.findings.map((f, i) => {
              const qualityReasons = validateFindingCandidate(f);
              return {
              key: `findingStatus:${i}`,
              main: `${f.identifierMark === "IDENTIFIER_EXPLICIT" ? `${f.identifierExplicit} (explicit ID)` : f.identifierMark === "AI_PROPOSED" ? `${f.title} (AI proposed)` : f.title}`,
              sub: `severity ${f.severity} (${f.severityMark}) · status ${f.statusSignal ?? "—"} · evidence ${f.evidence.length}${qualityReasons.length ? ` · blocked: ${qualityReasons.join(" ")}` : ""}`,
              evidence: f.evidence.map((e) => ({ messageIndex: e.messageIndex, excerpt: e.excerpt })),
              correctPlaceholder: "Corrected status (fixed / not_fixed / open / …)",
              };
            })}
            busyItem={busyItem}
            onApprove={(key) => decide("approve", key)}
            onReject={(key) => decide("reject", key)}
            onCorrect={(key, value) => decide("correct", key, value)}
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
            decisionsByKey={new Map(itemDecisions.map((d) => [d.itemKey, d]))}
            footer="Approving a finding writes it to the tracker after quality validation; rejected candidates are never written."
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
            openEvidence={openEvidence}
            setOpenEvidence={setOpenEvidence}
            decisionsByKey={new Map(itemDecisions.map((d) => [d.itemKey, d]))}
            footer="Approving an iteration signal records the review decision only; it does not change VAPT data."
          />

          {(() => {
            const rec = extraction.structured.engagementRecord;
            if (!rec) return null;
            const fieldDefs: Array<{ field: string; label: string }> = [
              { field: "mailSubject", label: "Mail Subject" },
              { field: "primaryPoc", label: "POC" },
              { field: "assignedMembers", label: "Assigned members" },
              { field: "requestedDate", label: "Requested date" },
              { field: "scanReportDate", label: "Scan/Report date" },
              { field: "iteration1Date", label: "Iteration 1 date" },
              { field: "iteration2Date", label: "Iteration 2 date" },
              { field: "iteration1Status", label: "Iteration 1 status" },
              { field: "iteration2Status", label: "Iteration 2 status" },
              { field: "comments", label: "Comments" },
              { field: "followUpDate", label: "Follow-up date" },
              { field: "followUpResponse", label: "Follow-up response" },
            ];
            const items = fieldDefs
              .filter(({ field }) => {
                const v = (rec as Record<string, unknown>)[field];
                return typeof v === "string" && v.trim().length > 0 && v.trim() !== "—";
              })
              .map(({ field, label }) => ({
                key: `engagementRecord:${field}`,
                main: `${label}: ${String((rec as Record<string, unknown>)[field]).slice(0, 240)}`,
                sub: "AI-proposed record field",
                evidence: rec.evidence.map((e) => ({ messageIndex: e.messageIndex, excerpt: e.excerpt })),
                correctPlaceholder: `Corrected ${label.toLowerCase()}`,
              }));
            return (
              <ReviewBlock
                title="Application record (mail subject, POC, dates, comments, follow-ups)"
                items={items}
                busyItem={busyItem}
                onApprove={(key) => decide("approve", key)}
                onReject={(key) => decide("reject", key)}
                onCorrect={(key, value) => decide("correct", key, value)}
                openEvidence={openEvidence}
                setOpenEvidence={setOpenEvidence}
                decisionsByKey={new Map(itemDecisions.map((d) => [d.itemKey, d]))}
                footer="Approving fills the field ONLY when the record is empty; typing a value and clicking Correct replaces it (your correction wins). Reject records the decision without changes."
              />
            );
          })()}
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
  openEvidence,
  setOpenEvidence,
  decisionsByKey = new Map(),
  footer,
}: {
  title: string;
  items: ReviewItem[];
  busyItem: string | null;
  onApprove: (itemKey: string) => void;
  onReject: (itemKey: string) => void;
  onCorrect: (itemKey: string, value: unknown) => void;
  openEvidence: string | null;
  setOpenEvidence: (v: string | null) => void;
  decisionsByKey?: Map<string, ItemDecisionData>;
  footer?: string;
}) {
  const [correctionValues, setCorrectionValues] = React.useState<Record<string, string>>({});
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
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <Badge variant="info">AI proposed</Badge>
                {(() => {
                  const decision = decisionsByKey.get(item.key);
                  if (!decision) return null;
                  const label = decision.decision === "approve" ? "Approved" : decision.decision === "reject" ? "Rejected" : "Corrected";
                  const variant = decision.decision === "approve" ? "good" : decision.decision === "reject" ? "critical" : "info";
                  return <Badge variant={variant}>{label}</Badge>;
                })()}
              </div>
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

            {(() => {
              const decision = decisionsByKey.get(item.key);
              if (decision) {
                return (
                  <p className="mt-2 rounded-md bg-tint-b px-3 py-2 text-[12px] text-ink-2">
                    This item was already {decision.decision === "approve" ? "approved" : decision.decision === "reject" ? "rejected" : "corrected"} and is read-only.
                    {decision.correctedValue !== null && decision.correctedValue !== undefined ? ` Corrected value: ${String(decision.correctedValue)}` : ""}
                  </p>
                );
              }
              return (
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
                    value={correctionValues[item.key] ?? ""}
                    onChange={(e) => setCorrectionValues((prev) => ({ ...prev, [item.key]: e.target.value }))}
                    aria-label={`Correction for ${item.key}`}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onCorrect(item.key, correctionValues[item.key] ?? "")}
                    disabled={busyItem === item.key || !(correctionValues[item.key] ?? "")}
                  >
                    Correct
                  </Button>
                </div>
              );
            })()}
          </li>
        ))}
      </ul>
      {footer ? <p className="mt-2 text-[11px] text-muted">{footer}</p> : null}
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

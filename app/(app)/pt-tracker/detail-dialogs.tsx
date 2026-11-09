"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, ListPlus, GitBranch, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function csrf(): string | null {
  const raw = document.cookie.split(";").map((c) => c.trim()).find((c) => c.startsWith("tm_csrf="));
  return raw ? raw.split("=").slice(1).join("=") : null;
}

const selectClass = "w-full rounded-lg border border-stroke bg-card px-3 py-2 text-[14px]";

/** Shared fetch helper for tracker mutations. */
async function mutate(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(csrf() ? { "x-csrf-token": csrf()! } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
const FINDING_STATES = ["open", "new", "fixed", "not_fixed", "not_retested", "removed", "out_of_scope", "not_applicable", "unknown"] as const;
const TC_STATES = ["included", "tested", "not_tested", "passed", "failed", "retested", "removed", "out_of_scope", "not_retained", "not_applicable", "not_retested"] as const;

export interface IterationLite {
  id: number;
  number: number;
  name: string;
}
export interface TestCaseLite {
  id: number;
  code: string;
  title: string;
}

export function FindingDialog({
  applicationId,
  iterations,
  testCases,
  latestIterationNumber,
}: {
  applicationId: number;
  iterations: IterationLite[];
  testCases: TestCaseLite[];
  latestIterationNumber: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [withTestCase, setWithTestCase] = React.useState(testCases.length > 0);
  const [title, setTitle] = React.useState("");
  const [severity, setSeverity] = React.useState<(typeof SEVERITIES)[number]>("high");
  const [status, setStatus] = React.useState<(typeof FINDING_STATES)[number]>("open");
  const [iterationId, setIterationId] = React.useState<number | "none">(iterations.find((i) => i.number === latestIterationNumber)?.id ?? iterations[0]?.id ?? "none");
  const [testCaseId, setTestCaseId] = React.useState<number>(testCases[0]?.id ?? 0);
  const [newTcTitle, setNewTcTitle] = React.useState("");
  const [newTcInclude, setNewTcInclude] = React.useState(false);
  const [description, setDescription] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Optional inline test case creation (Â§43 helper).
      let effectiveTcId = testCaseId > 0 ? testCaseId : null;
      if (withTestCase && newTcInclude && newTcTitle.trim().length >= 3) {
        const created = await mutate("/api/test-cases", "POST", {
          applicationId,
          title: newTcTitle.trim(),
          statusValue: "included",
        });
        if (!created.ok) {
          setError(String((created.data as { error?: { message?: string } }).error?.message ?? "Test case creation failed."));
          return;
        }
        effectiveTcId = ((created.data as { testCase?: { id: number } }).testCase)?.id ?? null;
        setNewTcInclude(false);
        setNewTcTitle("");
      }

      const res = await mutate("/api/findings", "POST", {
        applicationId,
        title: title.trim(),
        description: description.trim() || undefined,
        testCaseId: effectiveTcId,
        severityValue: severity,
        currentStatusValue: status,
      });
      if (!res.ok) {
        setError(String((res.data as { error?: { message?: string } }).error?.message ?? "Creating the finding failed."));
        return;
      }
      const findingId = (res.data as { finding?: { id: number } }).finding?.id;
      // Record the initial state on the selected iteration (history starts here).
      if (findingId && iterationId !== "none") {
        await mutate("/api/findings/" + findingId, "PATCH", {
          iterationId,
          severityValue: severity,
          statusValue: status,
        });
      }
      setOpen(false);
      setTitle("");
      setDescription("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} data-testid="add-finding">
        <Plus className="h-4 w-4" aria-hidden /> Add Finding
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New finding</DialogTitle>
            <DialogDescription>The initial state is recorded through the status history (append-only).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="f-title">Title</Label>
              <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="f-sev">Severity</Label>
                <select id="f-sev" value={severity} onChange={(e) => setSeverity(e.target.value as never)} className={selectClass}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="f-status">Initial status</Label>
                <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value as never)} className={selectClass}>
                  {FINDING_STATES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="f-iter">Iteration</Label>
                <select id="f-iter" value={iterationId} onChange={(e) => setIterationId(e.target.value === "none" ? "none" : Number(e.target.value))} className={selectClass}>
                  {iterations.length === 0 ? <option value="none">No iterations yet</option> : null}
                  {iterations.map((i) => (
                    <option key={i.id} value={i.id}>I{i.number} â€” {i.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="f-desc">Description (optional)</Label>
              <Input id="f-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="rounded-lg border border-stroke bg-band px-3 py-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={withTestCase} onChange={(e) => setWithTestCase(e.target.checked)} />
                Link a test case
              </label>
              {withTestCase ? (
                <div className="mt-2 space-y-2">
                  {testCases.length > 0 ? (
                    <select value={testCaseId} onChange={(e) => setTestCaseId(Number(e.target.value))} className={selectClass} aria-label="Test case">
                      {testCases.map((t) => (
                        <option key={t.id} value={t.id}>{t.code} â€” {t.title}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[12px] text-muted">No test cases exist yet â€” create one now:</p>
                  )}
                  {testCases.length === 0 || newTcInclude ? (
                    <Input placeholder="New test case title (min 3 chars)" value={newTcTitle} onChange={(e) => setNewTcTitle(e.target.value)} />
                  ) : (
                    <button type="button" className="text-[12px] text-progress underline" onClick={() => setNewTcInclude(true)}>
                      Create a new test case instead
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">Cancel</Button>
              <Button variant="accent" onClick={submit} disabled={busy || title.trim().length < 3}>
                {busy ? "Savingâ€¦" : "Create finding"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function IterationDialog({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [type, setType] = React.useState<"initial_scan" | "retest" | "follow_up" | "other">("retest");
  const [nameHint, setNameHint] = React.useState<string>("");
  const [notes, setNotes] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // The engagement is created implicitly only when missing (structural container), audited.
      const res = await mutate("/api/iterations", "POST", {
        applicationId,
        iterationTypeValue: type,
        name: nameHint.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (!res.ok) {
        setError(String((res.data as { error?: { message?: string } }).error?.message ?? "Creating the iteration failed."));
        return;
      }
      setOpen(false);
      setNameHint("");
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="create-iteration">
        <GitBranch className="h-4 w-4" aria-hidden /> Create Iteration
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create iteration</DialogTitle>
            <DialogDescription>
              Iteration 1 = Initial Scan; later iterations default to Retest. Iteration 1 data is never overwritten â€”
              retests create new history records.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="i-type">Type</Label>
                <select id="i-type" value={type} onChange={(e) => setType(e.target.value as never)} className={selectClass}>
                  <option value="retest">Retest</option>
                  <option value="initial_scan">Initial Scan</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label htmlFor="i-name">Name (optional)</Label>
                <Input id="i-name" placeholder={`e.g. Iteration 3 â€” ${type === "retest" ? "Retest" : "Follow-up"}`} value={nameHint} onChange={(e) => setNameHint(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="i-notes">Notes (optional)</Label>
              <Input id="i-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">Cancel</Button>
              <Button variant="accent" onClick={submit} disabled={busy}>
                {busy ? "Creatingâ€¦" : "Create iteration"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


export function TestCaseDialog({ applicationId }: { applicationId: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [category, setCategory] = React.useState("");

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await mutate("/api/test-cases", "POST", {
        applicationId,
        title: title.trim(),
        category: category.trim() || undefined,
        statusValue: "included",
      });
      if (!res.ok) {
        setError(String((res.data as { error?: { message?: string } }).error?.message ?? "Creating the test case failed."));
        return;
      }
      setOpen(false);
      setTitle("");
      setCategory("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid="add-test-case">
        <ListPlus className="h-4 w-4" aria-hidden /> Add Test Case
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New test case</DialogTitle>
            <DialogDescription>TC codes are permanent identities â€” removal is a state, never a deletion.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="tc-title">Title</Label>
              <Input id="tc-title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} required />
            </div>
            <div>
              <Label htmlFor="tc-cat">Category (optional)</Label>
              <Input id="tc-cat" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">Cancel</Button>
              <Button variant="accent" onClick={submit} disabled={busy || title.trim().length < 3}>
                {busy ? "Savingâ€¦" : "Create test case"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Â§44: update the CURRENT iteration state; previous states remain in history. */
export function FindingStateDialog({
  finding,
  iterations,
}: {
  finding: { id: number; title: string; severityValue: string };
  iterations: IterationLite[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<(typeof FINDING_STATES)[number]>("fixed");
  const [severity, setSeverity] = React.useState<(typeof SEVERITIES)[number]>(finding.severityValue as (typeof SEVERITIES)[number]);
  const [note, setNote] = React.useState("");
  const [iterationId, setIterationId] = React.useState<number>(iterations[iterations.length - 1]?.id ?? 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await mutate(`/api/findings/${finding.id}`, "PATCH", {
        iterationId,
        severityValue: severity,
        statusValue: status,
        retestNote: note.trim() || undefined,
      });
      if (!res.ok) {
        setError(String((res.data as { error?: { message?: string } }).error?.message ?? "Update rejected."));
        return;
      }
      setOpen(false);
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stroke-soft bg-card text-muted transition hover:border-accent hover:bg-accent-soft hover:text-accent-deep"
        onClick={() => setOpen(true)}
        aria-label="Update finding state"
        title="Update iteration state"
        data-testid={`finding-state-${finding.id}`}
      >
        <PenLine className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update state â€” {finding.title}</DialogTitle>
            <DialogDescription>Previous states stay in history. Current = latest authoritative iteration state.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="fs-iter">Iteration</Label>
                <select id="fs-iter" value={iterationId} onChange={(e) => setIterationId(Number(e.target.value))} className={selectClass}>
                  {iterations.map((i) => (
                    <option key={i.id} value={i.id}>I{i.number} â€” {i.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="fs-sev">Severity</Label>
                <select id="fs-sev" value={severity} onChange={(e) => setSeverity(e.target.value as never)} className={selectClass}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{s[0]!.toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="fs-status">New state</Label>
                <select id="fs-status" value={status} onChange={(e) => setStatus(e.target.value as never)} className={selectClass}>
                  {FINDING_STATES.map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="fs-note">Retest note (optional)</Label>
              <Input id="fs-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">Cancel</Button>
              <Button variant="accent" onClick={submit} disabled={busy || iterationId === 0}>
                {busy ? "Savingâ€¦" : "Record state"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TestCaseStateDialog({
  testCase,
  iterations,
}: {
  testCase: TestCaseLite;
  iterations: IterationLite[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<(typeof TC_STATES)[number]>("retested");
  const [notes, setNotes] = React.useState("");
  const [iterationId, setIterationId] = React.useState<number>(iterations[iterations.length - 1]?.id ?? 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await mutate("/api/test-cases", "PUT", {
        testCaseId: testCase.id,
        iterationId,
        statusValue: status === "not_retained" ? "removed" : status,
        notes: notes.trim() || undefined,
      });
      if (!res.ok) {
        setError(String((res.data as { error?: { message?: string } }).error?.message ?? "Update rejected."));
        return;
      }
      setOpen(false);
      setNotes("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="rounded-md p-1.5 text-muted transition hover:bg-band hover:text-ink"
        onClick={() => setOpen(true)}
        aria-label={`Set iteration state of ${testCase.code}`}
        title="Iteration state"
        data-testid={`tc-state-${testCase.code}`}
      >
        <PenLine className="h-4 w-4" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Iteration state â€” {testCase.code}</DialogTitle>
            <DialogDescription>Removed/Not Retested/Out of Scope preserve the case for future iterations.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tcs-iter">Iteration</Label>
                <select id="tcs-iter" value={iterationId} onChange={(e) => setIterationId(Number(e.target.value))} className={selectClass}>
                  {iterations.map((i) => (
                    <option key={i.id} value={i.id}>I{i.number}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="tcs-status">Status</Label>
                <select id="tcs-status" value={status} onChange={(e) => setStatus(e.target.value as never)} className={selectClass}>
                  {TC_STATES.filter((s) => s !== "not_retained").map((s) => (
                    <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="tcs-notes">Notes (optional)</Label>
              <Input id="tcs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error ? <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">Cancel</Button>
              <Button variant="accent" onClick={submit} disabled={busy || iterationId === 0}>
                {busy ? "Savingâ€¦" : "Record state"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}


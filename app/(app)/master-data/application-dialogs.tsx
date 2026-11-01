"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { Plus, Pencil, Tags, Trash2, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import {
  createApplicationAction,
  updateApplicationAction,
  addAliasAction,
  removeAliasAction,
  toggleApplicationActiveAction,
  type ResultState,
} from "./actions";
import type { ApplicationDTO } from "@/lib/services/application-service";

export interface MasterValueLite {
  id: number;
  domain: string;
  value: string;
  label: string;
  isActive?: boolean;
}

const selectClass = "w-full rounded-lg border border-stroke bg-card px-3 py-2 text-[14px]";
const of = (masterValues: MasterValueLite[], domain: string) =>
  masterValues.filter((m) => m.domain === domain && m.isActive !== false);

function AlertText({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="alert" className={"rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-[13px] text-accent " + (className ?? "")}>
      {children}
    </p>
  );
}

function environmentToLabel(label: string): string {
  switch (label.toLowerCase()) {
    case "prod":
    case "production":
      return "prod";
    case "uat":
      return "uat";
    case "staging":
      return "staging";
    case "dev":
    case "development":
      return "dev";
    default:
      return "unknown";
  }
}

/* ------------------------------------------------------------------ */
/* Toolbar: New Application                                             */
/* ------------------------------------------------------------------ */
export function ApplicationDialogs({ masterValues }: { masterValues: MasterValueLite[] }) {
  const [open, setOpen] = React.useState(false);
  const [state, formAction, pending] = useActionState(createApplicationAction, {} as ResultState);

  const wasOk = React.useRef(false);
  React.useEffect(() => {
    if (state.ok && !wasOk.current) {
      setOpen(false);
    }
    wasOk.current = state.ok === true;
  }, [state]);

  return (
    <>
      <Button variant="accent" onClick={() => setOpen(true)} data-testid="new-application">
        <Plus className="h-4 w-4" aria-hidden /> New Application
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Application</DialogTitle>
            <DialogDescription>Register an application in the master data registry.</DialogDescription>
          </DialogHeader>
          <form action={formAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Application name</Label>
                <Input id="name" name="name" required placeholder="e.g. Cash Portal Phase-1" />
              </div>
              <div>
                <Label htmlFor="displayName">Display name</Label>
                <Input id="displayName" name="displayName" placeholder="Optional friendly name" />
              </div>
              <div>
                <Label htmlFor="applicationTypeValue">Type</Label>
                <select id="applicationTypeValue" name="applicationTypeValue" required className={selectClass}>
                  {of(masterValues, "application_type").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="scopeValue">Internal / External</Label>
                <select id="scopeValue" name="scopeValue" required className={selectClass}>
                  {of(masterValues, "scope").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="environmentValue">Environment</Label>
                <select id="environmentValue" name="environmentValue" required className={selectClass}>
                  {of(masterValues, "environment").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="pocHint">POC</Label>
                <Input id="pocHint" name="pocHint" placeholder="Contacts management attaches later" disabled />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="webUrl">Web URL</Label>
                <Input id="webUrl" name="webUrl" type="url" placeholder="https://…" />
              </div>
              <div>
                <Label htmlFor="apiFqdn">API / FQDN</Label>
                <Input id="apiFqdn" name="apiFqdn" placeholder="api.example.akasaair.com" />
              </div>
              <div>
                <Label htmlFor="rawTarget">Other target (APK/bundle)</Label>
                <Input id="rawTarget" name="rawTarget" placeholder="com.app.akasaair.staging" />
              </div>
            </div>

            {state.error ? <AlertText>{state.error}</AlertText> : null}

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="accent" type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create application"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Row action: Edit + Alias manager + Activate/Deactivate               */
/* ------------------------------------------------------------------ */
export function RowActions({
  application,
  masterValues,
}: {
  application: ApplicationDTO;
  masterValues: MasterValueLite[];
}) {
  const [editOpen, setEditOpen] = React.useState(false);
  const [aliasOpen, setAliasOpen] = React.useState(false);
  const [confirmToggle, setConfirmToggle] = React.useState(false);
  const [editState, editForm, editPending] = useActionState(updateApplicationAction, {} as ResultState);
  const [aliasState, aliasForm, aliasPending] = useActionState(addAliasAction, {} as ResultState);

  const wasOk = React.useRef(false);
  React.useEffect(() => {
    if (editState.ok && !wasOk.current) setEditOpen(false);
    wasOk.current = editState.ok === true;
  }, [editState]);

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditOpen(true)}
        className="rounded-md p-1.5 text-muted transition hover:bg-band hover:text-ink"
        aria-label={`Edit ${application.displayName}`}
        title="Edit"
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setAliasOpen(true)}
        className="rounded-md p-1.5 text-muted transition hover:bg-band hover:text-ink"
        aria-label={`Manage aliases for ${application.displayName}`}
        title="Aliases"
      >
        <Tags className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setConfirmToggle(true)}
        className="rounded-md p-1.5 text-muted transition hover:bg-band hover:text-ink"
        aria-label={application.isActive ? `Deactivate ${application.displayName}` : `Activate ${application.displayName}`}
        title={application.isActive ? "Deactivate" : "Activate"}
      >
        {application.isActive ? <Archive className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
      </button>

      <ToggleConfirmDialog
        application={application}
        open={confirmToggle}
        onOpenChange={setConfirmToggle}
      />

      {/* EDIT */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit — {application.displayName}</DialogTitle>
            <DialogDescription>Registry fields. Deactivation preserves all history.</DialogDescription>
          </DialogHeader>
          <form action={editForm}>
            <input type="hidden" name="id" value={application.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`displayName-${application.id}`}>Display name</Label>
                <Input id={`displayName-${application.id}`} name="displayName" defaultValue={application.displayName} />
              </div>
              <div>
                <Label htmlFor={`type-${application.id}`}>Type</Label>
                <select
                  id={`type-${application.id}`}
                  name="applicationTypeValue"
                  defaultValue={application.typeName.toLowerCase()}
                  className={selectClass}
                >
                  {of(masterValues, "application_type").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`scope-${application.id}`}>Scope</Label>
                <select
                  id={`scope-${application.id}`}
                  name="scopeValue"
                  defaultValue={application.scopeLabel.toLowerCase()}
                  className={selectClass}
                >
                  {of(masterValues, "scope").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor={`env-${application.id}`}>Environment</Label>
                <select
                  id={`env-${application.id}`}
                  name="environmentValue"
                  defaultValue={environmentToLabel(application.environmentLabel)}
                  className={selectClass}
                >
                  {of(masterValues, "environment").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor={`webUrl-${application.id}`}>Web URL</Label>
                <Input id={`webUrl-${application.id}`} name="webUrl" defaultValue={application.webUrl ?? ""} type="url" />
              </div>
              <div>
                <Label htmlFor={`fqdn-${application.id}`}>API / FQDN</Label>
                <Input id={`fqdn-${application.id}`} name="apiFqdn" defaultValue={application.apiFqdn ?? ""} />
              </div>
              <div>
                <Label htmlFor={`target-${application.id}`}>Other target</Label>
                <Input id={`target-${application.id}`} name="rawTarget" defaultValue={application.rawTarget ?? ""} />
              </div>
            </div>

            {editState.error ? <AlertText>{editState.error}</AlertText> : null}

            <div className="flex justify-end gap-2 pt-2">
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Cancel
                </Button>
              </DialogClose>
              <Button variant="accent" type="submit" disabled={editPending}>
                {editPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ALIASES */}
      <Dialog open={aliasOpen} onOpenChange={setAliasOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aliases — {application.displayName}</DialogTitle>
            <DialogDescription>
              Future EML/AI matching resolves “Cash Portal ≈ CashPortal ≈ cash-portal ≈ UAT Cash Portal”.
            </DialogDescription>
          </DialogHeader>

          <ul className="mb-3 space-y-2">
            {application.aliases.length === 0 ? (
              <li className="text-[13px] text-muted">No aliases recorded yet.</li>
            ) : (
              application.aliases.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-lg border border-stroke px-3 py-2">
                  <div>
                    <p className="text-[14px] text-ink">{a.alias}</p>
                    <p className="text-[11px] text-muted">
                      {a.aliasTypeLabel} · normalized: {a.normalized}
                    </p>
                  </div>
                  <RemoveAliasButton aliasId={a.id} />
                </li>
              ))
            )}
          </ul>

          <form action={aliasForm} className="grid gap-3">
            <input type="hidden" name="applicationId" value={application.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`alias-${application.id}`}>New alias</Label>
                <Input id={`alias-${application.id}`} name="alias" required placeholder="cash-portal" />
              </div>
              <div>
                <Label htmlFor={`aliasType-${application.id}`}>Type (auto if empty)</Label>
                <select id={`aliasType-${application.id}`} name="aliasTypeValue" className={selectClass}>
                  <option value="">Auto-detect</option>
                  {of(masterValues, "alias_type").map((t) => (
                    <option key={t.id} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {aliasState.error ? <AlertText>{aliasState.error}</AlertText> : null}
            <div className="flex items-center justify-between gap-2">
              <Button variant="accent" type="submit" disabled={aliasPending}>
                {aliasPending ? "Adding…" : "Add alias"}
              </Button>
              <DialogClose asChild>
                <Button variant="outline" type="button">
                  Done
                </Button>
              </DialogClose>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RemoveAliasButton({ aliasId }: { aliasId: number }) {
  const [state, form, pending] = useActionState(removeAliasAction, {} as ResultState);
  return (
    <form action={form}>
      <input type="hidden" name="aliasId" value={aliasId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md p-1.5 text-muted transition hover:bg-band hover:text-accent"
        aria-label="Remove alias"
        title={state.error ?? "Remove alias"}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </form>
  );
}

function ToggleConfirmDialog({
  application,
  open,
  onOpenChange,
}: {
  application: ApplicationDTO;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const activate = !application.isActive;
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    const fd = new FormData();
    fd.set("id", String(application.id));
    fd.set("activate", activate ? "true" : "false");
    startTransition(async () => {
      try {
        await toggleApplicationActiveAction({}, fd);
      } finally {
        onOpenChange(false);
      }
    });
  };

  return (
    <ConfirmationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={activate ? `Activate ${application.displayName}?` : `Deactivate ${application.displayName}?`}
      description={
        activate
          ? "The application returns to the active registry."
          : "The application is hidden from the active registry. All history is preserved (brief section 60)."
      }
      confirmLabel={activate ? "Activate" : "Deactivate"}
      pending={pending}
      onConfirm={confirm}
    />
  );
}

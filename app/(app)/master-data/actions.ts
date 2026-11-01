"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireSession } from "@/lib/auth/guards";
import { CreateApplicationSchema, UpdateApplicationSchema, AddAliasSchema, RemoveAliasSchema } from "@/lib/validation/schemas";
import { createApplication, updateApplication, addAlias, removeAlias } from "@/lib/services/application-service";
import { AppError } from "@/lib/errors";

export interface ResultState {
  ok?: boolean;
  error?: string;
}

async function reqCtx() {
  const hdrs = await headers();
  return {
    ip: hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  };
}

function describe(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof ZodError) {
    return error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return "Unexpected error. Please retry.";
}

export async function createApplicationAction(_prev: ResultState, formData: FormData): Promise<ResultState> {
  try {
    const claims = await requireSession();
    const input = CreateApplicationSchema.parse({
      name: formData.get("name"),
      displayName: formData.get("displayName") || undefined,
      applicationTypeValue: formData.get("applicationTypeValue"),
      scopeValue: formData.get("scopeValue"),
      environmentValue: formData.get("environmentValue"),
      webUrl: formData.get("webUrl")?.toString() ?? "",
      apiFqdn: formData.get("apiFqdn")?.toString() ?? "",
      rawTarget: formData.get("rawTarget")?.toString() || undefined,
      primaryPocId: formData.get("primaryPocId") ? Number(formData.get("primaryPocId")) : null,
    });
    await createApplication(input, Number(claims.sub), await reqCtx());
    revalidatePath("/master-data");
    revalidatePath("/pt-tracker");
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function updateApplicationAction(_prev: ResultState, formData: FormData): Promise<ResultState> {
  try {
    const claims = await requireSession();
    const id = Number(formData.get("id"));
    const patch = UpdateApplicationSchema.parse({
      displayName: formData.get("displayName")?.toString() || undefined,
      applicationTypeValue: formData.get("applicationTypeValue")?.toString() || undefined,
      scopeValue: formData.get("scopeValue")?.toString() || undefined,
      environmentValue: formData.get("environmentValue")?.toString() || undefined,
      statusValue: formData.get("statusValue")?.toString() || undefined,
      webUrl: formData.get("webUrl")?.toString() ?? undefined,
      apiFqdn: formData.get("apiFqdn")?.toString() ?? undefined,
      rawTarget: formData.get("rawTarget")?.toString() || undefined,
      primaryPocId: formData.get("primaryPocId") ? Number(formData.get("primaryPocId")) : null,
    });
    await updateApplication(id, patch, Number(claims.sub), await reqCtx());
    revalidatePath("/master-data");
    revalidatePath("/pt-tracker");
    revalidatePath(`/pt-tracker/${id}`);
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function toggleApplicationActiveAction(_prev: ResultState, formData: FormData): Promise<ResultState> {
  try {
    const claims = await requireSession();
    const id = Number(formData.get("id"));
    const activate = formData.get("activate") === "true";
    await updateApplication(id, { isActive: activate }, Number(claims.sub), await reqCtx());
    revalidatePath("/master-data");
    revalidatePath("/pt-tracker");
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function addAliasAction(_prev: ResultState, formData: FormData): Promise<ResultState> {
  try {
    const claims = await requireSession();
    const input = AddAliasSchema.parse({
      applicationId: Number(formData.get("applicationId")),
      alias: formData.get("alias"),
      aliasTypeValue: formData.get("aliasTypeValue")?.toString() || undefined,
      notes: formData.get("notes")?.toString() || undefined,
    });
    await addAlias(input, Number(claims.sub), await reqCtx());
    revalidatePath("/master-data");
    revalidatePath("/pt-tracker");
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

export async function removeAliasAction(_prev: ResultState, formData: FormData): Promise<ResultState> {
  try {
    const claims = await requireSession();
    const { aliasId } = RemoveAliasSchema.parse({ aliasId: Number(formData.get("aliasId")) });
    await removeAlias(aliasId, Number(claims.sub), await reqCtx());
    revalidatePath("/master-data");
    revalidatePath("/pt-tracker");
    return { ok: true };
  } catch (error) {
    return { error: describe(error) };
  }
}

/**
 * Original .eml storage (Phase 4 §9).
 * Files are the authoritative raw source: stored VERBATIM on disk as
 * <root>/<yyyy>/<mm>/<sha256>.eml; the DB keeps the reference + metadata.
 * Filenames are never trusted or used for paths (only content-derived paths).
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export function emlRoot(): string {
  const configured = process.env.EML_STORAGE_ROOT ?? "storage/eml";
  return path.resolve(process.cwd(), configured);
}

export function sha256Buffer(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export interface StoredOriginal {
  sha256: string;
  absolutePath: string;
  storageReference: string; // relative, DB-stored
  sizeBytes: number;
}

export function storeEmlOriginal(content: Buffer): StoredOriginal {
  const sha256 = sha256Buffer(content);
  const root = emlRoot();
  const now = new Date();
  const dir = path.join(root, now.getUTCFullYear().toString(), String(now.getUTCMonth() + 1).padStart(2, "0"));
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = path.join(dir, `${sha256}.eml`);
  if (!fs.existsSync(absolutePath)) {
    fs.writeFileSync(absolutePath, content);
  }
  return {
    sha256,
    absolutePath,
    storageReference: path.relative(process.cwd(), absolutePath).replace(/\\/g, "/"),
    sizeBytes: content.length,
  };
}

/** Reading originals back (future reprocess flows) — access is server-only. */
export function readOriginal(storageReference: string): Buffer | null {
  const full = path.resolve(process.cwd(), storageReference);
  const root = emlRoot();
  if (!full.startsWith(root)) return null; // traversal guard — only files under the EML root
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full);
}

export function maxEmlBytes(): number {
  const mb = Number(process.env.MAX_EML_SIZE_MB ?? 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

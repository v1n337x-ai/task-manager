/**
 * Password handling (brief section 8): bcrypt hashing only — no plaintext ever
 * stored or logged. `bcryptjs` implements the bcrypt algorithm in pure JS
 * (documented deviation from the blueprint's native `bcrypt` — no native build
 * step on Windows; same algorithm).
 */
import bcrypt from "bcryptjs";

/** 12 rounds ≈ 250ms on a dev-class machine. Configurable via env. */
const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

export async function hashPassword(plain: string): Promise<string> {
  passwordPolicy(plain); // guard against weak seeded credentials
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Minimum password policy used at seed/change time (further policy lands later). */
export function passwordPolicy(plain: string): void {
  if (plain.length < 10) throw new Error("Password must be at least 10 characters.");
  if (!/[A-Za-z]/.test(plain) || !/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(plain)) {
    throw new Error("Password must contain letters plus a number or symbol.");
  }
}

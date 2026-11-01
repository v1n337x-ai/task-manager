/**
 * Authentication unit tests (brief section 52) — no database required.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { hashPassword, verifyPassword, passwordPolicy } from "@/lib/auth/password";
import { checkRateLimit, resetRateLimiter } from "@/lib/auth/rate-limit";
import { normalizeSubjectForThread } from "@/lib/services/email-foundation-service";
import { normalizeAlias, inferAliasType } from "@/lib/services/application-service";
import { LoginSchema } from "@/lib/validation/schemas";

describe("password handling", () => {
  it("hashes and verifies (bcrypt algorithm)", async () => {
    const hash = await hashPassword("TaskManager!2026");
    expect(hash).toMatch(/^\$2[aby]/);
    expect(await verifyPassword("TaskManager!2026", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("produces a different hash per call (salted)", async () => {
    const a = await hashPassword("Some!Password42");
    const b = await hashPassword("Some!Password42");
    expect(a).not.toEqual(b);
  });

  it("enforces the minimum policy", () => {
    expect(() => passwordPolicy("short1A")).toThrow();
    expect(() => passwordPolicy("NoDigitsHere")).toThrow();
    expect(() => passwordPolicy("Good!Password123")).not.toThrow();
  });

  it("rejects plaintext roundtrip shape (never stores plaintext)", async () => {
    const hash = await hashPassword("Another!Pass99");
    expect(hash).not.toContain("Another!Pass99");
  });
});

describe("login rate limiter", () => {
  beforeEach(() => resetRateLimiter());

  it("blocks after the configured attempts and reports retry seconds", () => {
    const key = "login:test@unit";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60).allowed).toBe(true);
    }
    const blocked = checkRateLimit(key, 5, 60);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("keys are independent per identity", () => {
    expect(checkRateLimit("login:a@1", 1, 60).allowed).toBe(true);
    expect(checkRateLimit("login:a@1", 1, 60).allowed).toBe(false);
    expect(checkRateLimit("login:b@1", 1, 60).allowed).toBe(true);
  });

  it("windows reset", () => {
    const key = "login:burst@x";
    expect(checkRateLimit(key, 1, -1).allowed).toBe(true); // expired window immediately re-open
    expect(checkRateLimit(key, 1, -1).allowed).toBe(true);
  });
});

describe("login validation schema", () => {
  it("requires email + password", () => {
    expect(LoginSchema.safeParse({ email: "admin@akasaair.com", password: "TaskManager!2026" }).success).toBe(true);
    expect(LoginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    expect(LoginSchema.safeParse({ email: "", password: "" }).success).toBe(false);
  });
});

describe("alias normalization (EML/AI seam, §16-17)", () => {
  it("treats spelling variants as one normalized key", () => {
    const expected = "cash portal";
    expect(normalizeAlias("Cash Portal")).toBe(expected);
    expect(normalizeAlias("  cash  Portal ")).toBe(expected);
  });

  it("infers alias types by shape", () => {
    expect(inferAliasType("https://uat.qp.akasaair.com/cash-portal")).toBe("url");
    expect(inferAliasType("cargo.akasaair.com")).toBe("fqdn");
    expect(inferAliasType("com.app.akasaair.staging")).toBe("package");
    expect(inferAliasType("Cash Portal UAT")).toBe("name");
  });
});

describe("email thread normalization (§28)", () => {
  it("strips reply markers and ticket tags for a stable thread key", () => {
    const a = "[Request ID :##SR-12732##] : Re: QP-GROUND-OPS-APP's APK for VAPT scan.";
    const b = "Fwd: QP-GROUND-OPS-APP's APK for VAPT scan.";
    expect(normalizeSubjectForThread(a)).toBe(normalizeSubjectForThread(b));
  });
});

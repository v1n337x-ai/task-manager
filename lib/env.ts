/**
 * Central environment access — no process.env reads scattered elsewhere.
 * Fails fast on missing production secrets, falls back to dev defaults locally.
 */
import { z } from "zod";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
    APPLICATION_SECRET: z.string().min(32, "APPLICATION_SECRET must be at least 32 chars"),
    APP_ENCRYPTION_KEY: z.string().min(32, "APP_ENCRYPTION_KEY must be at least 32 chars"),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(43200),
    SEED_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
    SEED_ADMIN_PASSWORD: z.string().min(10).default(""),
    NEXT_PUBLIC_APP_NAME: z.string().default("Task Manager"),
    NEXT_PUBLIC_APP_TAGLINE: z.string().default("VAPT"),
  })
  .superRefine((env, ctx) => {
    // Phase 2.1 §6: the encryption key must be a dedicated secret — never reuse.
    if (env.APP_ENCRYPTION_KEY === env.AUTH_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_ENCRYPTION_KEY"], message: "APP_ENCRYPTION_KEY must not reuse AUTH_SECRET" });
    }
    if (env.APP_ENCRYPTION_KEY === env.APPLICATION_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["APP_ENCRYPTION_KEY"], message: "APP_ENCRYPTION_KEY must not reuse APPLICATION_SECRET" });
    }
  });

let cached: z.infer<typeof EnvSchema> | null = null;

export function getEnv() {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    // Do not log AUTH_SECRET or APPLICATION_SECRET values.
    throw new Error(`Invalid environment configuration → ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Cookie/session context derived once per process. */
export const authContext = () => {
  const env = getEnv();
  return {
    cookieName: "tm_session",
    csrfCookieName: "tm_csrf",
    maxAgeSeconds: env.SESSION_TTL_SECONDS,
    issuer: "task-manager",
    audience: "task-manager-app",
  } as const;
};

export const isProduction = () => getEnv().NODE_ENV === "production";
export const isDevelopment = () => getEnv().NODE_ENV === "development";
export const isTest = () => getEnv().NODE_ENV === "test";

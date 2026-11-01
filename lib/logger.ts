/**
 * Structured JSON logger (brief section 47).
 * One line per event; no sensitive values ever pass through here.
 */
type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold =
  LEVELS[(process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === "development" ? "debug" : "info")] ?? LEVELS.info;

const REDACTED_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "auth_secret",
  "application_secret",
  "secret",
  "token",
  "cookie",
]);

function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) out[k] = "[REDACTED]";
    else if (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = sanitize(v as Record<string, unknown>);
    } else out[k] = v;
  }
  return out;
}

function emit(level: Level, event: string, meta: Record<string, unknown> = {}) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...sanitize({ app: "task-manager", ...meta }),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => emit("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => emit("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit("error", event, meta),
};

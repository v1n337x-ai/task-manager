"use client";

/**
 * Global error boundary (brief section 46): production shows a safe message.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" style={{ fontFamily: "system-ui, sans-serif" }}>
      <body style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#f8f8f8", color: "#2b2b2b" }}>
        <div style={{ maxWidth: 480, padding: 32, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: "#7a7a7a", fontSize: 14 }}>
            The error has been logged. You can retry now — if the problem persists, contact the platform team.
            {process.env.NODE_ENV === "development" ? ` [dev digest: ${error.digest ?? error.message}]` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, background: "#cf1325", color: "#fff", border: 0, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

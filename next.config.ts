import type { NextConfig } from "next";

// Next.js dev mode compiles modules with eval (HMR / react-refresh). Without
// 'unsafe-eval' the CSP kills the dev runtime before React hydrates, leaving
// every button dead. Production builds never eval, so the strict policy stays.
const isDev = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // App mounts under a sub-path like the reference enterprise portal pattern
  // (assetPrefix /cash-portal from Phase 1 study). Keep root path for Phase 2;
  // the toggle is documented, off by default.
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // Middleware runs on every request, so Next clones each request body to
    // hand it to the edge runtime. That clone is capped at 10MB by default:
    // a multi-file .eml upload above 10MB was silently truncated and
    // `request.formData()` threw before the route ever saw the files.
    // Keep this above MAX_EML_SIZE_MB plus multipart overhead.
    middlewareClientMaxBodySize: "32mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;

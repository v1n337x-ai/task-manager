import type { Metadata } from "next";

import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Login (brief section 7): centered card pattern from the digiALERT reference
 * study, brand-consistent with Phase 1 tokens. Deliberately undecorated.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = params.next && /^\/[a-z-]/.test(params.next) ? params.next : undefined;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page-soft px-4">
      {/* Akasa sky backdrop: plum gradient + sunrise glow + rising-A motif */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#3d2054] via-[#4d2a6d] to-[#5c3479]" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-accent/15 blur-3xl" />
        <svg viewBox="0 0 24 24" className="absolute right-[12%] top-[18%] h-24 w-24 text-white/10" fill="currentColor" aria-hidden>
          <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" />
        </svg>
      </div>

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent shadow-lg">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
              <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" fill="#fff" />
              <path d="M12 9.6 14.2 14h-4.4L12 9.6Z" fill="#E0550C" />
            </svg>
          </div>
          <p className="font-display text-4xl tracking-wide text-white">TASK MANAGER</p>
          <p className="mt-1 text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">VAPT</p>
          <p className="mt-4 text-sm text-white/70">Welcome — please sign in to your workspace</p>
        </div>

        <div className="rounded-2xl border border-white/40 bg-white px-6 py-8 shadow-[0_10px_40px_rgb(61_32_84/35%)]">
          <LoginForm nextPath={nextPath} />
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Akasa Air · It&apos;s Your Sky · Internal platform, single authorized credential
        </p>
      </div>
    </main>
  );
}

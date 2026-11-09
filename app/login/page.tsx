import type { Metadata } from "next";

import LoginForm from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Login (brief section 7): centered card pattern from the security-vendor reference
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
      {/* Task Manager sky backdrop: sunrise-orange wash into a soft violet dusk. */}
      <div aria-hidden className="absolute inset-0">
        <div className="absolute inset-0 bg-gradient-to-br from-[#fff0e6] via-[#fff9f5] to-[#f0e6ff]" />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-slate/25 blur-3xl" />
        <svg viewBox="0 0 24 24" className="absolute right-[12%] top-[18%] h-24 w-24 text-accent-deep/10" fill="currentColor" aria-hidden>
          <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" />
        </svg>
      </div>

      <div className="relative w-full max-w-[26rem]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-none bg-slate shadow-lg shadow-slate/25">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
              <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" fill="#fff" />
              <path d="M12 9.6 14.2 14h-4.4L12 9.6Z" fill="#E0550C" />
            </svg>
          </div>
          <p className="font-display text-4xl tracking-wide text-ink">TASK MANAGER</p>
          <p className="mt-1 text-[13px] font-semibold uppercase tracking-[0.22em] text-accent-deep">VAPT</p>
          <p className="mt-4 text-sm text-muted-2">Welcome — please sign in to your workspace</p>
        </div>

        <div className="relative overflow-hidden rounded-none border border-stroke bg-white px-6 py-8 shadow-[0_18px_50px_rgb(243_112_33/14%)]">
          <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-slate to-accent" />
          <LoginForm nextPath={nextPath} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Task Manager · It&apos;s Your Sky · Internal platform, single authorized credential
        </p>
      </div>
    </main>
  );
}

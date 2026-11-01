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
    <main className="flex min-h-screen items-center justify-center bg-page-soft px-4">
      <div className="w-full max-w-[26rem]">
        <div className="mb-6 text-center">
          <p className="font-display text-4xl tracking-wide text-ink">TASK MANAGER</p>
          <p className="mt-1 text-[13px] font-semibold uppercase tracking-[0.22em] text-accent">VAPT</p>
          <p className="mt-4 text-sm text-muted">Welcome — please sign in to your workspace</p>
        </div>

        <div className="rounded-xl border border-stroke bg-card px-6 py-8 shadow-sm">
          <LoginForm nextPath={nextPath} />
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Internal platform · single authorized credential
        </p>
      </div>
    </main>
  );
}

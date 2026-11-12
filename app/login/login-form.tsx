"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export default function LoginForm({ nextPath }: { nextPath?: string }) {
  const initial: LoginState = {};
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <form action={formAction} className="space-y-4" aria-label="Sign in to Task Manager">
      <input type="hidden" name="next" value={nextPath ?? ""} />

      <div>
        <label htmlFor="email" className="mb-1 block text-[13px] font-medium text-ink-2">
          Username / Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="w-full rounded-lg border border-stroke bg-card px-3 py-2 text-ink-2 placeholder:text-muted focus:outline-none"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="mb-1 block text-[13px] font-medium text-ink-2">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-stroke bg-card px-3 py-2 text-ink-2 placeholder:text-muted focus:outline-none"
          placeholder="••••••••••"
        />
      </div>

      {state.error ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}

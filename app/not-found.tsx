import Link from "next/link";

/** Missing record / route (brief section 46). */
export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-page-soft px-4">
      <div className="panel max-w-md p-8 text-center">
        <h1 className="font-display text-5xl text-ink">404</h1>
        <p className="mt-2 text-[14px] text-ink-2">This record or route does not exist.</p>
        <Link href="/dashboard" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}

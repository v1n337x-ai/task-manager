"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ListChecks, FileText, Settings2, Database, Menu, X, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

const NAV_GROUPS = [
  {
    label: "VAPT",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/pt-tracker", label: "PT Tracker", icon: ListChecks },
      { href: "/reports", label: "Reports", icon: FileText },
      { href: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
] as const;

export interface ShellUser {
  displayName: string;
  email: string;
}

/**
 * AppShell (brief sections 10-11): brand menu (logo area) offers
 * Master Data / Reports / Settings; sidebar holds the single VAPT group.
 * Reports exists exactly once — sidebar item (the brand menu links the same route).
 */
export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-4 pb-2 pt-5">
        <BrandMenu />
      </div>
      <div className="mx-3 mb-4 h-px bg-stroke" aria-hidden />
      <nav className="flex-1 space-y-6 px-3" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">{group.label}</p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition",
                      isActive(item.href)
                        ? "bg-accent-soft font-semibold text-accent-deep"
                        : "text-ink-2 hover:bg-band",
                    )}
                  >
                    <item.icon className={cn("h-4 w-4", isActive(item.href) ? "text-accent" : "text-muted")} aria-hidden />
                    {item.label}
                    {isActive(item.href) ? <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" aria-hidden /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="px-3 pb-4">
        <p className="flex items-center justify-between rounded-lg bg-tint-b px-3 py-2 text-[11px] text-muted">
          <span>Akasa Air · It&apos;s Your Sky</span>
          <span className="h-2 w-2 rounded-full bg-good/80" aria-hidden />
        </p>
      </div>
    </div>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-page-soft">
        {/* Topbar */}
        <header className="brand-band sticky top-0 z-30">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md p-2 text-ink-2 hover:bg-tint-b lg:hidden"
                onClick={() => setMobileOpen((v) => !v)}
                aria-expanded={mobileOpen}
                aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <BrandMenu />
            </div>
            <div className="flex items-center gap-4">
              <span className="hidden text-[13px] text-ink-2 sm:inline" data-testid="user-chip">
                {user.displayName} · {user.email}
              </span>
              <button
                type="button"
                onClick={logout}
                className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-[12px] text-ink-2 transition hover:bg-tint-b"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                Sign out
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-[1600px]">
          {/* Desktop sidebar */}
          <aside className="side-rail sticky top-[52px] hidden h-[calc(100vh-52px)] w-60 shrink-0 lg:block">
            {sidebar}
          </aside>

          {/* Mobile drawer */}
          {mobileOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="fixed inset-0 bg-ink/40" onClick={() => setMobileOpen(false)} aria-hidden />
              <aside className="side-rail absolute left-0 top-0 h-full w-64 shadow-xl">{sidebar}</aside>
            </div>
          ) : null}

          <main className="min-w-0 flex-1 pb-10">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Brand/logo menu — brief §10: access to Master Data, Reports, Settings. */
function BrandMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-none px-2 py-1.5 text-left transition hover:bg-tint-b focus:outline-none"
          aria-haspopup="menu"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-none bg-slate text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
              {/* Akasa "rising A" motif — wing shaping inside the A */}
              <path d="M12 3.5 21 21h-4.6l-1.9-4h-5l-1.9 4H3L12 3.5Z" fill="#fff" />
              <path d="M12 9.6 14.2 14h-4.4L12 9.6Z" fill="#E0550C" />
            </svg>
          </span>
          <span>
            <span className="block font-display text-[18px] leading-4 tracking-wide text-ink">TASK MANAGER</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.28em] text-accent">VAPT</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Platform</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/master-data">
            <Database className="h-4 w-4 text-muted" aria-hidden /> Master Data
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/reports">
            <FileText className="h-4 w-4 text-muted" aria-hidden /> Reports
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings2 className="h-4 w-4 text-muted" aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Protected workspace</DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

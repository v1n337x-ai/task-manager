import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/auth/guards";
import { toPublicUser } from "@/lib/services/user-service";
import { DbUnavailableState } from "@/components/states";

/**
 * Authenticated route-group layout (brief sections 10-12).
 * requireSession() re-verifies server-side — hiding UI is never the only rule.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  let shell: React.ReactNode;
  try {
    const claims = await requireSession();
    const user = await toPublicUser(Number(claims.sub));
    if (!user) {
      shell = <DbUnavailableState />;
    } else {
      return <AppShell user={{ displayName: user.displayName, email: user.email }}>{children}</AppShell>;
    }
  } catch {
    shell = <DbUnavailableState />;
  }
  return shell;
}

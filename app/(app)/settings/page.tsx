import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { getAiConfigSafe } from "@/lib/services/ai-config-service";
import { listProviders } from "@/lib/ai/provider-catalog";
import { AiConfigPanel } from "./ai-config-panel";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (user-directed minimal layout): ONLY the AI provider configuration.
 * The informational schema/import-export/phase cards live in docs, not here.
 */
export default async function SettingsPage() {
  const aiInitial = await getAiConfigSafe().catch(() => null);
  const aiProviders = listProviders();

  return (
    <>
      <PageHeader title="SETTINGS" subtitle="AI provider configuration" />

      <PageBody className="space-y-6">
        <section aria-labelledby="s-ai" id="ai">
          <h2 id="s-ai" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink">AI</h2>
          {aiInitial ? (
            <AiConfigPanel initial={aiInitial} providers={aiProviders} />
          ) : (
            <div className="panel px-5 py-4" role="alert">
              <p className="text-[13px] font-semibold text-ink">AI configuration unavailable</p>
              <p className="mt-1 text-[13px] text-muted">The database was not reachable, so the configuration could not be loaded.</p>
            </div>
          )}
        </section>
      </PageBody>
    </>
  );
}

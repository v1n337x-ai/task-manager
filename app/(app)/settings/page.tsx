import type { Metadata } from "next";
import { PageHeader, PageBody } from "@/components/page-header";
import { getAiConfigSafe } from "@/lib/services/ai-config-service";
import { getBrandingColors } from "@/lib/services/branding-service";
import { getTemplateStatus } from "@/lib/services/ppt-template-service";
import { listProviders } from "@/lib/ai/provider-catalog";
import { AiConfigPanel } from "./ai-config-panel";
import { BrandingPanel } from "./branding-panel";
import { PptTemplatePanel } from "./ppt-template-panel";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings (user-directed minimal layout): ONLY the AI provider configuration.
 * The informational schema/import-export/phase cards live in docs, not here.
 */
export default async function SettingsPage() {
  const aiInitial = await getAiConfigSafe().catch(() => null);
  const aiProviders = listProviders();
  const branding = await getBrandingColors().catch(() => null);
  const pptTemplate = await getTemplateStatus().catch(() => null);

  return (
    <>
      <PageHeader title="SETTINGS" subtitle="Theme, AI provider and exports" />

      <PageBody className="space-y-6">
        <section aria-labelledby="s-branding" id="branding">
          <h2 id="s-branding" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink">Branding</h2>
          {branding ? (
            <BrandingPanel initial={branding} />
          ) : (
            <div className="panel px-5 py-4" role="alert">
              <p className="text-[13px] font-semibold text-ink">Theme settings unavailable</p>
              <p className="mt-1 text-[13px] text-muted">The database was not reachable, so the theme colors could not be loaded.</p>
            </div>
          )}
        </section>
        <section aria-labelledby="s-ppt-template" id="ppt-template">
          <h2 id="s-ppt-template" className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-ink">PPT template</h2>
          <PptTemplatePanel initial={pptTemplate} />
        </section>
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

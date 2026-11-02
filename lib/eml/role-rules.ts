/**
 * Deterministic participant-role rules for EML ingestion (user-requested:
 * "pentester and dev should be detected automatically from the .eml files").
 * Pure function — no AI, no network; evidence comes ONLY from the email
 * itself (domain, display name, body language). Every match stores
 * roleSource=RULE with a confidence in 60..90; no evidence ⇒ returns null and
 * the participant stays UNKNOWN (honest — never fabricated).
 */
export interface RoleInference {
  role: "pentester" | "developer" | "application_owner" | "security_team";
  confidence: number;
  basis: string;
}

const PENTESTER_DOMAINS = ["digialert"];
const VENDOR_HINTS = ["pentest", "vapt", "penetration", "security", "retest", "re-test"];
const OWNER_HINTS = ["owner", "product", "manager"];
const DEV_HINTS = ["developer", "dev team", "engineering", "fix"];
const DEV_BODY = /\b(has been|have been|is now|are now)? ?(fixed|resolved|remediated|patched|deployed)\b/i;
const PENTEST_BODY = /\b(retest(ed|ing)?|penetration test|still vulnerable|still reproducible|not fixed|risk rating|vulnerability)\b/i;

export function inferParticipantRoleFromEml(params: {
  email: string;
  name?: string | null;
  bodyHint?: string | null;
}): RoleInference | null {
  const email = (params.email ?? "").toLowerCase();
  const name = (params.name ?? "").toLowerCase();
  const body = (params.bodyHint ?? "").toLowerCase();
  if (!email) return null;

  const domain = email.includes("@") ? email.split("@")[1]! : email;

  // 1) Vendor team domain — the pentest vendor's own addresses (strong signal).
  if (PENTESTER_DOMAINS.some((d) => domain.includes(d))) {
    const bodyBacks = PENTEST_BODY.test(body);
    return { role: "pentester", confidence: bodyBacks ? 90 : 78, basis: bodyBacks ? "digialert vendor domain + retest language in body" : "digialert vendor domain" };
  }

  // 2)body-strong signals (independent of domain).
  const isPentestBody = PENTEST_BODY.test(body);
  const isDevBody = DEV_BODY.test(body);
  if (isPentestBody && !isDevBody) {
    return { role: "pentester", confidence: 76, basis: "retest/penetration language in the message body" };
  }
  if (isDevBody && !isPentestBody) {
    return { role: "developer", confidence: 72, basis: "fix/remediation language in the message body" };
  }

  // 3) Airline-side roles from name hints.
  if (DEV_HINTS.some((h) => name.includes(h) || email.includes(h)) && domain.includes("akasa")) {
    return { role: "developer", confidence: 68, basis: "developer wording on an Akasa address" };
  }
  if (OWNER_HINTS.some((h) => name.includes(h)) && domain.includes("akasa")) {
    return { role: "application_owner", confidence: 64, basis: "owner wording on an Akasa address" };
  }
  if (VENDOR_HINTS.some((h) => name.includes(h)) || VENDOR_HINTS.some((h) => email.includes(h))) {
    return { role: "pentester", confidence: 60, basis: "vendor/test-team wording in the display name or address" };
  }

  // 4) Default Akasa-side participant without evidence stays UNKNOWN (honest).
  return null;
}

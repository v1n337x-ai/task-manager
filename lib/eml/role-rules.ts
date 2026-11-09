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

const PENTESTER_DOMAINS = ["security-vendor", "pentest"];
const CLIENT_DOMAINS = ["example.com", "example.net", "example.org", "client"];
const VENDOR_HINTS = ["pentest", "vapt", "penetration", "security", "retest", "re-test", "infosec", "ciso"];
const OWNER_HINTS = ["owner", "product", "manager"];
const DEV_HINTS = ["developer", "dev team", "engineering"];
const SECURITY_HINTS = ["security", "infosec", "ciso", "appsec"];
// Remediation language must be an actual fix statement, not a bare status
// word ("fixed" in an "Open/Closed status" table is reporting, not fixing).
const DEV_BODY = /\b(?:has been|have been|was|were|is now|are now|we(?:'ve| have)?|they(?:'ve| have)?)\s+(?:been\s+)?(?:fixed|resolved|remediated|patched|deployed)\b|\b(?:fixed|resolved|remediated|patched|deployed)\s+(?:to|in|on)\s+(?:uat|prod|production|staging)\b/i;
const PENTEST_BODY = /\b(retest(ed|ing)?|penetration test|still vulnerable|still reproducible|not fixed|risk rating|open and closed status)\b/i;

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
    return { role: "pentester", confidence: bodyBacks ? 90 : 78, basis: bodyBacks ? "configured security-vendor domain + retest language in body" : "configured security-vendor domain" };
  }

  // 2) body-strong signals (independent of domain).
  const isPentestBody = PENTEST_BODY.test(body);
  const isDevBody = DEV_BODY.test(body) && !/not\s+(?:fixed|resolved)/i.test(body);
  const isSecurityTitle = /ciso|chief information security|information security officer/i.test(body);
  if (isPentestBody && !isDevBody) {
    // Client-side senders reporting VAPT status are the security team, not
    // the vendor; vendor senders are the pentest team.
    const role = CLIENT_DOMAINS.some((d) => domain.includes(d)) ? "security_team" : "pentester";
    return { role, confidence: 76, basis: "retest/penetration language in the message body" };
  }
  if (isDevBody && !isPentestBody) {
    return { role: "developer", confidence: 72, basis: "fix/remediation language in the message body" };
  }

  // Client-side roles from name/email hints.
  if (CLIENT_DOMAINS.some((d) => domain.includes(d))) {
    if (SECURITY_HINTS.some((h) => name.includes(h) || email.includes(h)) || isSecurityTitle) {
      return { role: "security_team", confidence: 70, basis: "security wording on a client address" };
    }
    if (DEV_HINTS.some((h) => name.includes(h) || email.includes(h))) {
      return { role: "developer", confidence: 68, basis: "developer wording on a client address" };
    }
    if (OWNER_HINTS.some((h) => name.includes(h))) {
      return { role: "application_owner", confidence: 64, basis: "owner wording on a client address" };
    }
  }
  if (VENDOR_HINTS.some((h) => name.includes(h)) || VENDOR_HINTS.some((h) => email.includes(h))) {
    return { role: "pentester", confidence: 60, basis: "vendor/test-team wording in the display name or address" };
  }

  // 4) Default client-side participant without evidence stays UNKNOWN (honest).
  return null;
}

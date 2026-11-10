/**
 * Participant-role rules — CLIENT-AGNOSTIC (v3, 2026-11).
 *
 * Deterministic inference from evidence inside the .eml itself: sender email
 * tokens, display-name tokens, and the SENDER'S OWN words in the message.
 * No evidence ⇒ returns null and the participant stays UNKNOWN (honest —
 * never fabricated).
 *
 * IMPORTANT: no client or vendor NAME is hardcoded. A future client (any
 * company, any domain) works exactly the same — the classifier keys on
 * generic role language, never on a specific brand string.
 *
 * Priority (strongest identity evidence wins):
 *   1. name/title identity (security consultant titles → pentester)
 *   2. pentest/vapt vendor mailboxes → pentester
 *   3. signature titles in the sender's own body (CISO → security_team,
 *      SRE/product/IT manager → application_owner)
 *   4. assessment-action language in the sender's own words (PFA summary,
 *      initiating the assessment, retest completed) → pentester
 *   5. security-function mailbox/name tokens (infosec, appsec, soc) → security_team
 *   6. fix/remediation language (client engineering confirming a fix) → developer
 *   7. owner/manager name hints → application_owner
 */
export interface RoleInference {
  role: "pentester" | "developer" | "application_owner" | "security_team";
  confidence: number;
  basis: string;
}

/** Word tokens that identify the ASSESSMENT-side (pentest/consultancy) mailboxes. */
const PENTEST_TOKENS = ["pentest", "vapt", "penetration", "redteam", "offsec", "seclab"];

/** Word tokens on a person/mailbox that identify a CLIENT security function. */
const SECURITY_HINTS = ["infosec", "security", "ciso", "appsec", "secops"];

/** Word tokens that identify DEVELOPMENT roles. */
const DEV_HINTS = ["developer", "engineering", "dev team"];

/** Word tokens that identify APPLICATION OWNERS / managers. */
const OWNER_HINTS = ["owner", "product", "manager", "sre"];

// Assessment team ACTIVITY in the sender's own words (not a quoted table):
const ASSESSOR_ACTION =
  /\b(?:we\s+(?:will\s+be\s+)?(?:initiat|perform|conduct|complete|complet)|pfa\s+(?:summary|findings|report)|findings\s+summary|retest\s+(?:is\s+|was\s+)?complet|still\s+(?:vulnerable|reproducible)|we\s+are\s+considering|we\s+identified|we\s+found)\b/i;
// Client-side REQUEST language (asking the assessor to act):
const CLIENT_REQUEST =
  /\b(?:could\s+you\s+(?:please\s+)?(?:retest|provide|add|share)|kindly\s+(?:provide|retest|cordinate|coordinate)|please\s+(?:provide|drop|retake))\b/i;
// Remediation language must be an actual fix statement, not a bare status word.
const DEV_BODY =
  /\b(?:has\s+been|have\s+been|was|were|is\s+now|are\s+now|we(?:'ve|\s+have)?|they(?:'ve|\s+have)?)\s+(?:been\s+)?(?:fixed|resolved|remediated|patched|deployed)\b|\b(?:fixed|resolved|remediated|patched|deployed)\s+(?:to|in|on)\s+(?:uat|prod|production|staging)\b/i;

/** Security-title recognition in the message / signature text. */
const SECURITY_TITLE = /\b(?:ciso|chief\s+information\s+security\s+officer|chief\s+information\s+security|information\s+security\s+officer|head\s+of\s+information\s+security|security\s+officer)\b/i;
/** Pentester-title in names ("Security Consultant", "Penetration Tester"). */
const PENTEST_NAME =
  /\b(?:security\s+consultant|penetration\s+tester|penetration\s+analyst|security\s+analyst|vapt\s+analyst|security\s+engineer)\b/i;
/** Owner/management titles inside the signature. */
const OWNER_TITLE = /\b(?:sre\s+manager|product\s+owner|application\s+owner|it\s+manager|engineering\s+manager|platform\s+manager)\b/i;

function safeLower(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

export function inferParticipantRoleFromEml(params: {
  email: string;
  name?: string | null;
  bodyHint?: string | null;
}): RoleInference | null {
  const email = safeLower(params.email);
  const name = safeLower(params.name);
  if (!email) return null;

  // The rules read the participant's OWN words. Outlook reply chains embed the
  // whole quoted conversation — including other senders' retest/VAPT language —
  // inside the body. Everything from the first quoted-header line onward is
  // earlier mail, so it is cut before classification (mirrors the UI fold).
  const OWN_BODY_CUT = /^\s*(?:>\s*)?(?:From|Sent|To|Cc|Bcc|Subject|Date|Original Message)\s*:?/im;
  const rawBody = safeLower(params.bodyHint);
  const cut = rawBody.search(OWN_BODY_CUT);
  const body = (cut >= 0 ? rawBody.slice(0, cut) : rawBody).trim();

  const domain = email.includes("@") ? email.split("@")[1]! : email;
  const hostTokens = domain.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
  const localPart = email.includes("@") ? email.split("@")[0]! : "";

  // 1) Identity by name/title: pentest-consultant titles → pentester.
  if (PENTEST_NAME.test(name) || PENTEST_NAME.test(localPart)) {
    return { role: "pentester", confidence: 78, basis: "pentest/security-consultant title in the sender name" };
  }

  // 2) Vendor-domain mailbox — the assessment team's own domain.
  const hostIsPentestClient = PENTEST_TOKENS.some((t) => domain.includes(t));
  if (hostIsPentestClient) {
    const bodyBacks = ASSESSOR_ACTION.test(body);
    return {
      role: "pentester",
      confidence: bodyBacks ? 90 : 78,
      basis: bodyBacks ? "pentest/vapt domain + assessment language in body" : "pentest/vapt mailbox domain",
    };
  }

  // 3) Signature titles in the sender's own body (client-agnostic — a CISO
  //    working on ANY company's domain is client security leadership).
  if (SECURITY_TITLE.test(body)) {
    return { role: "security_team", confidence: 68, basis: "security title in the message signature" };
  }
  if (OWNER_TITLE.test(body)) {
    return { role: "application_owner", confidence: 64, basis: "owner/manager title in the message signature" };
  }

  // 4) Assessment-action language in the sender's own words.
  if (ASSESSOR_ACTION.test(body) && !CLIENT_REQUEST.test(body)) {
    return { role: "pentester", confidence: 76, basis: "assessment activity language in the message body" };
  }

  // 5) Security-function mailbox/name tokens.
  const securityToken = SECURITY_HINTS.some(
    (h) => hostTokens.includes(h) || localPart.includes(h) || name.includes(h),
  );
  if (securityToken) {
    return { role: "security_team", confidence: 70, basis: "security wording on the sender identity" };
  }

  // 6) Fix/remediation language in the sender's own words → client engineering.
  const isDevBody = DEV_BODY.test(body) && !/not\s+(?:fixed|resolved)/i.test(body);
  if (isDevBody && !CLIENT_REQUEST.test(body)) {
    return { role: "developer", confidence: 72, basis: "fix/remediation language in the message body" };
  }

  // 7) Owner/development name hints.
  if (DEV_HINTS.some((h) => name.includes(h))) {
    return { role: "developer", confidence: 68, basis: "developer wording on the sender identity" };
  }
  if (OWNER_HINTS.some((h) => name.includes(h)) || OWNER_TITLE.test(body)) {
    return { role: "application_owner", confidence: 64, basis: "owner/manager wording on the sender identity" };
  }

  // Honest default: no reliable evidence → stays UNKNOWN.
  return null;
}

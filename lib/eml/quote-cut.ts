/**
 * Universal "own words only" quote cut for archived email (user direction 2026-11).
 *
 * A single archived .eml usually carries the WHOLE reply chain: the sender's
 * new message at the top, then `From:/Sent:/To:` forwarded headers quoting
 * every earlier mail. Storing that verbatim makes each conversation card
 * repeat the entire thread instead of showing just the one new mail.
 *
 * This helper splits the body into `own` (the new content) and `quoted`
 * (everything from the first forwarded-header block onward). It is applied
 * at IMPORT time so every message row holds only its own new content — one
 * uploaded .eml becomes exactly one clean card. The verbatim original .eml
 * stays archived on disk (lib/eml/storage.ts), so no history is lost, and the
 * UI's cosmetic fold keeps working for rows imported before this change.
 *
 * Both the text and HTML variants are deliberately tolerant: Outlook desktop
 * (_____ + From:), OWA (<hr> + <b>From:</b>), Gmail (blockquote) and generic
 * clients are all covered by one mechanism.
 */

export type QuoteSplit = { own: string; quoted: string | null };

/** Outlook / RFC style forwarded-header line, at the start of a line. */
const HEADER_LINE = /^[ \t]*(?:>[ \t]*)?(?:From|Sent|To|Cc|Bcc|Subject|Date|Original Message|Importance|Attachments)[ \t]*:/im;
/** `-----Original Message-----` style separators. */
const ORIGINAL_MESSAGE = /^[ \t]*[-―—]{2,}[ \t]*Original Message[ \t]*[-―—]{2,}[ \t]*$/im;
/** A horizontal rule line immediately before a forwarded header (Outlook _____). */
const RULE_BEFORE = /(?:^|\n)[ \t]*(?:_{5,}|-{5,}|={5,})[ \t]*\r?\n?$/;

/**
 * Split a plain-text body at the first forwarded header. The preceding
 * horizontal rule (_____ / -----) is treated as part of the quote boundary so
 * `own` ends with the sender's actual closing lines, not a stray separator.
 */
export function splitOwnText(body: string | null | undefined): QuoteSplit {
  if (!body) return { own: body ?? "", quoted: null };

  const header = HEADER_LINE.exec(body);
  const original = ORIGINAL_MESSAGE.exec(body);
  const indices = [header?.index, original?.index].filter((n): n is number => typeof n === "number");
  if (indices.length === 0) return { own: body, quoted: null };

  let cut = Math.min(...indices);
  const before = body.slice(0, cut);
  const rule = RULE_BEFORE.exec(before);
  if (rule) {
    const leadingNewline = rule[0].startsWith("\n") ? 1 : 0;
    cut = (rule.index ?? 0) + leadingNewline;
  }

  return { own: body.slice(0, cut).trim(), quoted: body.slice(cut) };
}

/**
 * Split an HTML body at the first forwarded-header container. Handles raw
 * (pre-sanitizer) HTML as well as the sanitized HTML rendered by the UI, so
 * ingestion and display share one definition of "earlier mail".
 */
export function splitOwnHtml(html: string | null | undefined): QuoteSplit {
  if (!html) return { own: html ?? "", quoted: null };

  // Collect EVERY valid boundary and take the EARLIEST. A single client can
  // emit several markers (Word-filtered Outlook has a <p><b>From:</b> header
  // well before its <hr> + divRplyFwdMsg block) — first-match-priority would
  // cut too late and leave quoted mail in the "own" half.
  const candidates: number[] = [];

  // OWA / Outlook web: <hr> followed within 1500 chars by a bold From:/Sent:
  // header block (the sanitizer keeps <b>, so this works before and after it).
  for (const hr of html.matchAll(/<hr(?=[\s>])/gi)) {
    const at = hr.index ?? 0;
    const windowHtml = html.slice(at, at + 1500);
    if (/<b>\s*From:\s*<\/b>/i.test(windowHtml) || /<b>\s*Sent:\s*<\/b>/i.test(windowHtml) || /From:\s*<\/(?:b|strong)>/i.test(windowHtml)) {
      candidates.push(at);
    }
  }

  // Raw OWA container ids (present before sanitization).
  for (const owa of html.matchAll(/id="(?:x_)?divRplyFwdMsg"/gi)) {
    const idx = owa.index ?? 0;
    const containerStart = html.lastIndexOf("<div", idx);
    candidates.push(containerStart >= 0 ? containerStart : idx);
  }

  // Blockquote-wrapped chains (Gmail / Outlook desktop / Apple Mail).
  const bq = /<blockquote[\s>]/i.exec(html);
  if (bq && bq.index !== undefined) candidates.push(bq.index);

  // Generic forwarded-header marker: a div/p containing From: (tags such as
  // <b>/<span> may wrap the label, including Word's <b><span>From:</span></b>),
  // validated by a nearby Sent:/Subject:/To: line. `From:` is followed by
  // optional whitespace because clients close the tag immediately after it.
  for (const marker of html.matchAll(/<(?:div|p)(?:\s[^>]*)?>\s*(?:<[^>]+>\s*)*From:\s*/gi)) {
    const idx = marker.index ?? 0;
    const windowText = html.slice(idx, idx + 1800).replace(/<[^>]*>/g, " ");
    if (/Sent:/i.test(windowText) || /Subject:/i.test(windowText) || /To:/i.test(windowText)) {
      candidates.push(idx);
    }
  }

  // Generic separator emitted by some clients.
  const original = /-----Original Message-----/i.exec(html);
  if (original && original.index !== undefined) candidates.push(original.index);

  if (candidates.length === 0) return { own: html, quoted: null };
  const cut = Math.min(...candidates);
  return { own: html.slice(0, cut), quoted: html.slice(cut) };
}

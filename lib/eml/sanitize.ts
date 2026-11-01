/**
 * HTML sanitization (Phase 4 §7): bodies may render in the conversation view
 * — nothing can execute. sanitize-html strips scripts/iframes/events/URL
 * schemes; external references (img/cid) stay inert; CSS classes stripped.
 */
import sanitizeHtmlLib from "sanitize-html";

export function sanitizeEmailHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return sanitizeHtmlLib(raw, {
    allowedTags: [
      "p", "br", "b", "strong", "i", "em", "u", "strike", "blockquote", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "pre", "code", "span", "div", "table", "thead", "tbody",
      "tr", "td", "th", "hr", "font", "a",
    ],
    allowedAttributes: {
      a: ["href"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["https"],
    // cid: inline images are referenced but NOT linked to attachments here;
    // render attachments separately from their metadata rows.
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
    },
    disallowedTagsMode: "discard",
    allowProtocolRelative: false,
  });
}

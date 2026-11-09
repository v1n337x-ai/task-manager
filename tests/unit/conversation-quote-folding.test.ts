/**
 * Regression: conversation quote folding must keep earlier mail folded and
 * must never glue quoted bodies into envelope values or render the whole
 * chain inside a later bubble. Mirrors the real Akasa Jenkins chain shapes:
 * Outlook plain-text chains and OWA HTML (<hr> + <b>From:</b> stacks).
 */
import { describe, expect, it } from "vitest";
import {
  parseNeatBlocks,
  splitHtmlQuote,
  type NeatBlock,
} from "@/app/(app)/pt-tracker/[applicationId]/email-panel";

// Windows Outlook plain-text chain (Vineet's 20 Oct style).
const TEXT_CHAIN = [
  "Hi @Santosh Mhatre (Consultant)",
  "",
  "While performing the VAPT for Akasa Air Jenkins, I noticed that I currently have only non admin access.",
  "Could you please temporarily add my account to the jenkins-admins group?",
  "",
  "Regards,",
  "Vineet Sanjeev",
  "From: Yash Shah <yash.shah@akasaair.com>",
  "Sent: 17 October 2026 20:03",
  "To: Vineet Khalkho(Consultant) <vineet.khalkho@akasaair.com>",
  "Subject: Re: [Request ID :##SR-44233##] : Re: Akasa Air Jenkins – VAPT",
  "",
  "Okay Vineet.",
  "",
  "Please notify us in case of any further delays.",
  "",
  "Regards,",
  "",
  "Yash Shah",
  "",
  "",
  "From: Vineet Khalkho(Consultant) <vineet.khalkho@akasaair.com>",
  "Sent: Saturday, 17 October 2026 18:34:50",
  "To: Yash Shah <yash.shah@akasaair.com>",
  "Subject: Re: [Request ID :##SR-44233##] : Re: Akasa Air Jenkins – VAPT",
  "",
  "Hi @Yash Shah",
  "",
  "While the VAPT assessment was in progress, testing was disrupted due to an access issue.",
  "",
  "Regards,",
  "Vineet Sanjeev",
].join("\n");

// OWA HTML (sanitized: ids/styles stripped, <b>/<hr>/<div>/<font> kept).
const OWA_HTML = [
  "<div><p>Hi @Yash Shah</p><p>The VPN access issue is still pending.</p></div>",
  "<div><p>Regards,</p><p>Vineet Sanjeev</p></div>",
  "<hr>",
  "<div><font><b>From:</b> Yash Shah &lt;yash.shah@akasaair.com&gt;<br><b>Sent:</b> 17 October 2026 20:03<br><b>To:</b> Vineet Khalkho(Consultant)<br><b>Subject:</b> Re: Akasa Air Jenkins – VAPT<br></font>",
  "<div><p>Okay Vineet.</p><p>Please notify us in case of any further delays.</p></div></div>",
].join("");

/** Same split NeatTextBody performs: everything from the first envelope is quoted. */
function foldSplit(blocks: { type: string }[]) {
  const first = blocks.findIndex((b) => b.type === "envelope");
  return first === -1 ? [] : blocks.slice(first);
}

describe("conversation quote folding (Jenkins chain regression)", () => {
  it("text: envelope values stay clean; quoted bodies become folded text", () => {
    const blocks = parseNeatBlocks(TEXT_CHAIN) as NeatBlock[];
    const kinds = blocks.map((b) => b.type);
    expect(kinds[0]).toBe("text");
    expect(kinds).toContain("envelope");
    // No envelope pair may swallow the quoted body sentences.
    for (const b of blocks) {
      if (b.type === "envelope") {
        for (const [label, value] of b.pairs) {
          expect(value).not.toMatch(/Please notify us|testing was disrupted/);
          expect(label === "Subject" || value.length < 240).toBe(true);
        }
      }
    }
    const folded = foldSplit(blocks);
    expect(folded.length).toBeGreaterThan(0);
    expect(folded[0]?.type).toBe("envelope");
    // The second quoted mail opens a second envelope OR its body text is folded too.
    const envelopes = folded.filter((b) => b.type === "envelope");
    expect(envelopes.length).toBeGreaterThanOrEqual(2);
  });

  it("text: a body opening with an envelope still folds (firstEnvelope === 0)", () => {
    const blocks = parseNeatBlocks(
      ["From: A <a@x.com>", "Sent: 1 Jan 2026 10:00", "Subject: hi", "", "quoted body text here"].join("\n"),
    ) as NeatBlock[];
    expect(blocks[0]?.type).toBe("envelope");
    const folded = foldSplit(blocks);
    expect(folded.length).toBeGreaterThan(0);
  });

  it("owa html: chain splits at <hr> + <b>From:</b>, head keeps new reply only", () => {
    const { head, quoted } = splitHtmlQuote(OWA_HTML);
    expect(head).toContain("The VPN access issue is still pending");
    expect(head).not.toContain("Please notify us");
    expect(quoted).toContain("Please notify us");
    expect(quoted).toContain("From:");
  });

  it("html: blockquote and unquoted mail are untouched", () => {
    expect(splitHtmlQuote("<p>a</p><blockquote><p>b</p></blockquote>")).toEqual({
      head: "<p>a</p>",
      quoted: "<blockquote><p>b</p></blockquote>",
    });
    expect(splitHtmlQuote("<p>only new content</p>").quoted).toBeNull();
  });
});

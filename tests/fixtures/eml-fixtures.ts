/**
 * Synthetic .eml fixture builders for Phase 4 tests.
 * Encoding patterns mirror the Phase 1 workbook: quoted-printable bodies,
 * encoded headers (RFC 2047), nested multipart/related with inline attachment.
 */
import path from "node:path";
import fs from "node:fs";

export const chainA = `From: Vineet S <vineet@security-vendor.test>
To: Task Manager Team <appowner@client.test>
Cc: security@client.test
Subject: VAPT Findings - Application X
Date: Mon, 02 Nov 2026 09:30:00 +0530
Message-ID: <chainA-0001@security-vendor.test>
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

Iteration 1 report contains 3 findings for Application X.
`;

export const chainB = `From: appowner@client.test
To: vineet@security-vendor.test
Subject: Re: VAPT Findings - Application X
Date: Mon, 02 Nov 2026 17:12:00 +0530
In-Reply-To: <chainA-0001@security-vendor.test>
References: <chainA-0001@security-vendor.test>
Message-ID: <chainB-0002@client.test>
Content-Type: text/plain; charset=utf-8

Developer response: High severity findings F-001 and F-002 are fixed.
`;

export const chainC = `From: vineet@security-vendor.test
To: appowner@client.test
Subject: Re: Re: VAPT Findings - Application X
Date: Tue, 03 Nov 2026 10:00:00 +0530
References: <chainA-0001@security-vendor.test> <chainB-0002@client.test>
Message-ID: <chainC-0003@security-vendor.test>
Content-Type: text/plain; charset=utf-8

Retest completed. High severity F-001 Fixed. F-002 Not Fixed.
`;

export const multipartWithAttachment = `From: vineet@security-vendor.test
To: appowner@client.test
Subject: =?UTF-8?Q?Report_with_attachment_=E2=80=93_CashPortal?=
Date: Thu, 05 Nov 2026 09:00:00 +0530
Message-ID: <multi-0100@security-vendor.test>
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="MIX-BOUNDARY"

--MIX-BOUNDARY
Content-Type: multipart/alternative; boundary="ALT-BOUNDARY"

--ALT-BOUNDARY
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: quoted-printable

Please find the report attached. Also check the inline note.

--ALT-BOUNDARY
Content-Type: text/html; charset=utf-8
Content-Transfer-Encoding: quoted-printable

<html><body><p>HTML body with <strong>markup</strong></p><script>alert('evil')</script><img src=3D"https://evil.test/x.png"></body></html>

--ALT-BOUNDARY--
--MIX-BOUNDARY
Content-Type: text/plain; charset=utf-8
Content-Disposition: attachment; filename="report-notes.txt"
Content-Transfer-Encoding: base64

Q2FzaCBQb3J0YWwgY2hlY2sgbm90ZXM=
--MIX-BOUNDARY--
`;

export const noMessageId = `From: tester@lab.test
To: appowner@client.test
Subject: FW: Unlabelled probe submission
Date: Fri, 06 Nov 2026 11:00:00 +0530
Content-Type: text/plain

No message id present in this one.
`;

export function writeFixtures(dir: string): Record<string, string> {
  fs.mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = {
    "chain-a.eml": chainA,
    "chain-b.eml": chainB,
    "chain-c.eml": chainC,
    "multipart.eml": multipartWithAttachment,
    "no-message-id.eml": noMessageId,
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return files;
}

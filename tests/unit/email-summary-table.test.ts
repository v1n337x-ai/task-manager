import { describe, expect, it } from "vitest";
import { parseNeatBlocks } from "@/app/(app)/pt-tracker/[applicationId]/email-panel";

describe("email summary table parser", () => {
  it("parses the vertical field-per-line layout from stored .eml text", () => {
    const body = [
      "#",
      "Name of the vulnerability",
      "Severity",
      "Status",
      "1",
      "Unauthorized Mass HR PII Disclosure via LLM Tool Invocation",
      "Critical",
      "Not Fixed / New Finding",
      "2",
      "Unauthenticated API Endpoint Access",
      "Critical",
      "Not Fixed",
      "",
      "Regards,",
    ].join("\n");

    const blocks = parseNeatBlocks(body);
    const table = blocks.find((block) => block.type === "summaryTable");
    expect(table).toEqual({
      type: "summaryTable",
      statusLabels: ["Status"],
      rows: [
        { no: 1, title: "Unauthorized Mass HR PII Disclosure via LLM Tool Invocation", severity: "critical", statuses: ["Not Fixed / New Finding"] },
        { no: 2, title: "Unauthenticated API Endpoint Access", severity: "critical", statuses: ["Not Fixed"] },
      ],
    });
  });

  it("parses a one-line summary table", () => {
    const body = [
      "# Name of the vulnerability Severity Status",
      "1 Missing Security Headers High Not Fixed / New Finding",
      "2 Missing API Versioning Low Not Fixed",
    ].join("\n");

    const table = parseNeatBlocks(body).find((block) => block.type === "summaryTable");
    expect(table).toEqual({
      type: "summaryTable",
      statusLabels: ["Status"],
      rows: [
        { no: 1, title: "Missing Security Headers", severity: "high", statuses: ["Not Fixed / New Finding"] },
        { no: 2, title: "Missing API Versioning", severity: "low", statuses: ["Not Fixed"] },
      ],
    });
  });

  it("parses pipe-delimited tables with common header synonyms", () => {
    const body = [
      "S.No. | Vulnerability | Risk | State",
      "| 1 | Missing Security Headers | High | Not Fixed / New Finding |",
      "| 2 | Missing API Versioning | Low | Not Fixed |",
    ].join("\n");
    const table = parseNeatBlocks(body).find((block) => block.type === "summaryTable");
    expect(table).toEqual({
      type: "summaryTable",
      statusLabels: ["State"],
      rows: [
        { no: 1, title: "Missing Security Headers", severity: "high", statuses: ["Not Fixed / New Finding"] },
        { no: 2, title: "Missing API Versioning", severity: "low", statuses: ["Not Fixed"] },
      ],
    });
  });

  it("parses vertical tables with header synonyms", () => {
    const body = [
      "S.No",
      "Vulnerability",
      "Risk",
      "State",
      "1",
      "Missing Security Headers",
      "High",
      "Not Fixed / New Finding",
      "2",
      "Missing API Versioning",
      "Low",
      "Not Fixed",
    ].join("\n");
    const table = parseNeatBlocks(body).find((block) => block.type === "summaryTable");
    expect(table).toEqual({
      type: "summaryTable",
      statusLabels: ["State"],
      rows: [
        { no: 1, title: "Missing Security Headers", severity: "high", statuses: ["Not Fixed / New Finding"] },
        { no: 2, title: "Missing API Versioning", severity: "low", statuses: ["Not Fixed"] },
      ],
    });
  });

  it("parses vertical UAT and production status columns", () => {
    const body = [
      "#",
      "Name of the vulnerability",
      "Severity",
      "UAT Status",
      "Prod Status",
      "1",
      "Weak Webhook Authentication Token Exposure",
      "High",
      "Fixed",
      "Fixed",
      "2",
      "Incomplete Remediation of OIDC Case-Sensitivity Vulnerability (CVE-2025-24399)",
      "High",
      "Fixed",
      "Fixed",
    ].join("\n");
    const table = parseNeatBlocks(body).find((block) => block.type === "summaryTable");
    expect(table).toEqual({
      type: "summaryTable",
      statusLabels: ["UAT Status", "Prod Status"],
      rows: [
        { no: 1, title: "Weak Webhook Authentication Token Exposure", severity: "high", statuses: ["Fixed", "Fixed"] },
        { no: 2, title: "Incomplete Remediation of OIDC Case-Sensitivity Vulnerability (CVE-2025-24399)", severity: "high", statuses: ["Fixed", "Fixed"] },
      ],
    });
  });
});

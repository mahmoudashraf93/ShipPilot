import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CodexPilotConfig } from "../config/schema.js";
import type { RunReport } from "./jsonReport.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function renderJunitReport(report: RunReport): string {
  const failures = report.cases.filter((entry) => entry.result.status === "failed").length;
  const errors = report.cases.filter((entry) => entry.result.status === "blocked").length;
  const testcases = report.cases
    .map((entry) => {
      const result = entry.result;
      const name = escapeXml(`${result.case_id}: ${result.title}`);
      const body =
        result.status === "failed"
          ? `<failure message="${escapeXml(result.failure_reason ?? result.summary)}">${escapeXml(
              result.observed,
            )}</failure>`
          : result.status === "blocked"
            ? `<error message="${escapeXml(result.blocked_reason ?? result.summary)}">${escapeXml(
                result.observed,
              )}</error>`
            : "";
      return `    <testcase classname="CodexPilot iOS" name="${name}">${body}</testcase>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="CodexPilot iOS" tests="${report.cases.length}" failures="${failures}" errors="${errors}">`,
    testcases,
    "</testsuite>",
    "",
  ].join("\n");
}

export function writeJunitReport(config: CodexPilotConfig, report: RunReport, cwd = process.cwd()): void {
  const outputDir = path.resolve(cwd, config.reports.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "junit.xml"), renderJunitReport(report));
}

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ShipPilotConfig } from "../config/schema.js";
import type { RunReport } from "./jsonReport.js";

function statusIcon(status: string): string {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  return "BLOCKED";
}

export function renderMarkdownReport(report: RunReport): string {
  const lines = [
    "# ShipPilot Report",
    "",
    `Status: ${statusIcon(report.status)}`,
    `Started: ${report.started_at}`,
    `Completed: ${report.completed_at}`,
    "",
    "## Cases",
    "",
  ];

  for (const entry of report.cases) {
    const result = entry.result;
    lines.push(
      `### ${statusIcon(result.status)} ${result.case_id}: ${result.title}`,
      "",
      result.summary,
      "",
      `Expected: ${result.expected}`,
      "",
      `Observed: ${result.observed}`,
      "",
      `Confidence: ${result.confidence}`,
      "",
    );

    if (result.failure_reason) {
      lines.push(`Failure reason: ${result.failure_reason}`, "");
    }
    if (result.blocked_reason) {
      lines.push(`Blocked reason: ${result.blocked_reason}`, "");
    }
    if (result.executed_steps.length > 0) {
      lines.push("Executed steps:", "");
      lines.push(...result.executed_steps.map((step) => `- ${step}`), "");
    }
    if (result.evidence.length > 0) {
      lines.push("Evidence:", "");
      lines.push(...result.evidence.map((item) => `- ${item}`), "");
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

export function writeMarkdownReport(
  config: ShipPilotConfig,
  report: RunReport,
  cwd = process.cwd(),
): void {
  const outputDir = path.resolve(cwd, config.reports.output_dir);
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "report.md"), renderMarkdownReport(report));
}

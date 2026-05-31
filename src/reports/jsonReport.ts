import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ShipPilotConfig } from "../config/schema.js";
import type { CaseRunRecord } from "../codex/runWithSdk.js";

export type RunReport = {
  status: "passed" | "failed" | "blocked";
  started_at: string;
  completed_at: string;
  cases: CaseRunRecord[];
};

export function summarizeStatus(cases: CaseRunRecord[]): RunReport["status"] {
  if (cases.some((entry) => entry.result.status === "failed")) {
    return "failed";
  }
  if (cases.some((entry) => entry.result.status === "blocked")) {
    return "blocked";
  }
  return "passed";
}

export function writeJsonReport(
  config: ShipPilotConfig,
  cases: CaseRunRecord[],
  startedAt: string,
  cwd = process.cwd(),
): RunReport {
  const outputDir = path.resolve(cwd, config.reports.output_dir);
  mkdirSync(outputDir, { recursive: true });

  const report: RunReport = {
    status: summarizeStatus(cases),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    cases,
  };

  writeFileSync(path.join(outputDir, "run.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export function readJsonReport(runPath: string, cwd = process.cwd()): RunReport {
  return JSON.parse(readFileSync(path.resolve(cwd, runPath), "utf8")) as RunReport;
}

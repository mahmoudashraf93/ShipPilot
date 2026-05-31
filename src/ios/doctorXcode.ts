import { existsSync } from "node:fs";
import path from "node:path";
import type { ShipPilotConfig } from "../config/schema.js";
import { runCommand, type CheckResult } from "./xcodebuildmcp.js";

export function doctorXcode(config: ShipPilotConfig, cwd = process.cwd()): CheckResult[] {
  const projectPath = config.ios.project ?? config.ios.workspace;
  const checks: CheckResult[] = [
    runCommand("xcodebuild", ["-version"], cwd),
    runCommand("xcodebuildmcp", ["--help"], cwd),
    runCommand("xcodebuildmcp", ["simulator", "list"], cwd),
  ];

  checks.push({
    name: "iOS project/workspace",
    ok: Boolean(projectPath && existsSync(path.resolve(cwd, projectPath))),
    detail: projectPath ? path.resolve(cwd, projectPath) : "Missing ios.project or ios.workspace",
  });

  return checks;
}

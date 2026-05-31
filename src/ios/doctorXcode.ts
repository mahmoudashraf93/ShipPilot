import { existsSync } from "node:fs";
import path from "node:path";
import type { ShipPilotConfig } from "../config/schema.js";
import { resolveXcodeBuildMcpCommand, runCommand, type CheckResult } from "./xcodebuildmcp.js";

export function doctorXcode(config: ShipPilotConfig, cwd = process.cwd()): CheckResult[] {
  const projectPath = config.ios.project ?? config.ios.workspace;
  let xcodeBuildMcp: string | null = null;
  let xcodeBuildMcpResolution: CheckResult | null = null;

  try {
    xcodeBuildMcp = resolveXcodeBuildMcpCommand();
  } catch (error) {
    xcodeBuildMcpResolution = {
      name: "bundled xcodebuildmcp",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const checks: CheckResult[] = [runCommand("xcodebuild", ["-version"], cwd)];

  if (xcodeBuildMcpResolution) {
    checks.push(xcodeBuildMcpResolution);
  } else if (xcodeBuildMcp) {
    checks.push(runCommand(xcodeBuildMcp, ["--help"], cwd, "bundled xcodebuildmcp"));
    checks.push(runCommand(xcodeBuildMcp, ["simulator", "list"], cwd, "bundled xcodebuildmcp simulator list"));
  }

  checks.push({
    name: "iOS project/workspace",
    ok: Boolean(projectPath && existsSync(path.resolve(cwd, projectPath))),
    detail: projectPath ? path.resolve(cwd, projectPath) : "Missing ios.project or ios.workspace",
  });

  return checks;
}

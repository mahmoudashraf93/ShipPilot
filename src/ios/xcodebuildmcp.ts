import { spawnSync } from "node:child_process";
import path from "node:path";
import type { CodexPilotConfig } from "../config/schema.js";

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
};

export function runCommand(command: string, args: string[], cwd = process.cwd()): CheckResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return {
    name: [command, ...args].join(" "),
    ok: result.status === 0,
    detail: (result.stdout || result.stderr || "").trim(),
  };
}

export function buildRunArgs(config: CodexPilotConfig): string[] {
  const args = [
    "simulator",
    "build-run-sim",
    "--scheme",
    config.ios.scheme,
    "--simulator-name",
    config.ios.simulator,
  ];

  if (config.ios.project) {
    args.push("--project-path", config.ios.project);
  } else if (config.ios.workspace) {
    args.push("--workspace-path", config.ios.workspace);
  }

  return args;
}

export function projectFileExists(config: CodexPilotConfig, cwd = process.cwd()): boolean {
  const projectPath = config.ios.project ?? config.ios.workspace;
  return Boolean(projectPath && path.resolve(cwd, projectPath));
}

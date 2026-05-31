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

function addProjectOrWorkspace(args: string[], config: CodexPilotConfig): string[] {
  if (config.ios.project) {
    args.push("--project-path", config.ios.project);
  } else if (config.ios.workspace) {
    args.push("--workspace-path", config.ios.workspace);
  }

  return args;
}

function addSimulator(args: string[], config: CodexPilotConfig, simulatorId?: string): string[] {
  if (simulatorId) {
    args.push("--simulator-id", simulatorId);
  } else {
    args.push("--simulator-name", config.ios.simulator);
  }
  return args;
}

export function buildArgs(config: CodexPilotConfig, simulatorId?: string): string[] {
  return addProjectOrWorkspace(
    addSimulator(
      [
      "simulator",
      "build",
      "--scheme",
      config.ios.scheme,
      "--configuration",
      config.ios.configuration,
    ],
      config,
      simulatorId,
    ),
    config,
  );
}

export function getAppPathArgs(config: CodexPilotConfig, simulatorId?: string): string[] {
  return addProjectOrWorkspace(
    addSimulator(
      [
      "simulator",
      "get-app-path",
      "--scheme",
      config.ios.scheme,
      "--platform",
      "iOS Simulator",
      "--configuration",
      config.ios.configuration,
    ],
      config,
      simulatorId,
    ),
    config,
  );
}

export function getBundleIdArgs(appPath: string): string[] {
  return ["simulator", "get-app-bundle-id", "--app-path", appPath];
}

export function installArgs(config: CodexPilotConfig, appPath: string, simulatorId?: string): string[] {
  return addSimulator(["simulator", "install", "--app-path", appPath], config, simulatorId);
}

export function launchArgs(config: CodexPilotConfig, bundleId: string, simulatorId?: string): string[] {
  return addSimulator(["simulator", "launch-app", "--bundle-id", bundleId], config, simulatorId);
}

export function projectFileExists(config: CodexPilotConfig, cwd = process.cwd()): boolean {
  const projectPath = config.ios.project ?? config.ios.workspace;
  return Boolean(projectPath && path.resolve(cwd, projectPath));
}

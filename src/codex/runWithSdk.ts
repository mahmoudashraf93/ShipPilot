import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { CodexPilotConfig } from "../config/schema.js";
import type { ResolvedCase } from "../cases/resolveEnv.js";
import type { Redactor } from "../security/redact.js";
import { prepareCodexAuth } from "../auth/prepareCodexHome.js";
import {
  buildArgs,
  getAppPathArgs,
  getBundleIdArgs,
  installArgs,
  launchArgs,
} from "../ios/xcodebuildmcp.js";
import { buildCodexPrompt } from "./promptBuilder.js";
import { codexOutputJsonSchema, parseCodexResult, type CodexCaseResult } from "./outputSchema.js";

export type CaseRunRecord = {
  result: CodexCaseResult;
  rawFinalResponse: string;
  startedAt: string;
  completedAt: string;
};

type ProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    verbose: boolean;
    redactor: Redactor;
    timeoutMs?: number;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.verbose) {
      console.log(`[codexpilot] $ ${[command, ...args].join(" ")}`);
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (options.verbose) process.stdout.write(options.redactor.redact(text));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (options.verbose) process.stderr.write(options.redactor.redact(text));
    });

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

function combinedOutput(result: ProcessResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

function blockedRecord(
  qaCase: ResolvedCase,
  startedAt: string,
  summary: string,
  observed: string,
): CaseRunRecord {
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    rawFinalResponse: "",
    result: {
      status: "blocked",
      case_id: qaCase.id,
      title: qaCase.title,
      summary,
      executed_steps: [summary],
      expected: qaCase.body,
      observed,
      failure_reason: null,
      blocked_reason: observed,
      confidence: "high",
      evidence: [],
    },
  };
}

function expandTilde(value: string): string {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function parseJsonValue(output: string, keys: string[]): string | null {
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  } catch {
    return null;
  }
  return null;
}

function parseAppPath(output: string): string | null {
  const jsonValue = parseJsonValue(output, ["appPath", "app_path", "path"]);
  if (jsonValue) return expandTilde(jsonValue);
  const matches = output.match(/(?:~\/|\/)[^\n"']+?\.app/g);
  const match = matches?.at(-1);
  return match ? expandTilde(match.trim()) : null;
}

function parseBundleId(output: string): string | null {
  const jsonValue = parseJsonValue(output, ["bundleId", "bundle_id", "bundleIdentifier"]);
  if (jsonValue) return jsonValue;
  const matches = output.match(/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g);
  return matches?.at(-1) ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSimulatorId(output: string, simulatorName: string): string | null {
  const escapedName = escapeRegExp(simulatorName);
  const match = output.match(new RegExp(`-\\s*${escapedName}\\s*\\(([A-Fa-f0-9-]{36})\\)`));
  return match?.[1] ?? null;
}

function logCodexEvent(event: unknown, redactor: Redactor): void {
  const typed = event as {
    type?: string;
    item?: {
      type?: string;
      text?: string;
      command?: string;
      status?: string;
      exit_code?: number;
      aggregated_output?: string;
      server?: string;
      tool?: string;
      error?: { message?: string };
    };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      reasoning_output_tokens?: number;
    };
    error?: { message?: string };
    message?: string;
  };

  if (typed.type === "item.started" && typed.item) {
    if (typed.item.type === "command_execution") {
      console.log(`[codexpilot:agent] command started: ${typed.item.command ?? ""}`);
      return;
    }
    if (typed.item.type === "mcp_tool_call") {
      console.log(`[codexpilot:agent] tool started: ${typed.item.server ?? "mcp"}.${typed.item.tool ?? ""}`);
      return;
    }
    console.log(`[codexpilot:agent] ${typed.item.type ?? "item"} started`);
    return;
  }

  if (typed.type === "item.completed" && typed.item) {
    if (typed.item.type === "reasoning" && typed.item.text) {
      console.log(`[codexpilot:agent] reasoning summary: ${redactor.redact(typed.item.text)}`);
      return;
    }
    if (typed.item.type === "agent_message" && typed.item.text) {
      console.log(`[codexpilot:agent] message: ${redactor.redact(typed.item.text)}`);
      return;
    }
    if (typed.item.type === "command_execution") {
      console.log(
        `[codexpilot:agent] command ${typed.item.status ?? "completed"} exit=${typed.item.exit_code ?? "n/a"}: ${
          typed.item.command ?? ""
        }`,
      );
      if (typed.item.aggregated_output) {
        console.log(redactor.redact(typed.item.aggregated_output));
      }
      return;
    }
    if (typed.item.type === "mcp_tool_call") {
      const suffix = typed.item.error?.message ? ` error=${typed.item.error.message}` : "";
      console.log(
        `[codexpilot:agent] tool ${typed.item.status ?? "completed"}: ${
          typed.item.server ?? "mcp"
        }.${typed.item.tool ?? ""}${suffix}`,
      );
      return;
    }
    console.log(`[codexpilot:agent] ${typed.item.type ?? "item"} completed`);
    return;
  }

  if (typed.type === "turn.completed") {
    const usage = typed.usage;
    console.log(
      `[codexpilot:agent] turn completed input=${usage?.input_tokens ?? "n/a"} output=${
        usage?.output_tokens ?? "n/a"
      } reasoning=${usage?.reasoning_output_tokens ?? "n/a"}`,
    );
    return;
  }

  if (typed.type === "turn.failed" || typed.type === "error") {
    console.log(`[codexpilot:agent] error: ${typed.error?.message ?? typed.message ?? "unknown"}`);
  }
}

export async function runCaseWithSdk(
  config: CodexPilotConfig,
  qaCase: ResolvedCase,
  redactor: Redactor,
  cwd = process.cwd(),
  verbose = config.codex.verbose,
): Promise<CaseRunRecord> {
  mkdirSync(path.resolve(cwd, config.reports.output_dir), { recursive: true });
  const startedAt = new Date().toISOString();

  const simulatorList = await runProcess("xcodebuildmcp", ["simulator", "list"], {
    cwd,
    env: process.env,
    verbose,
    redactor,
    timeoutMs: 60 * 1000,
  });
  const simulatorId = parseSimulatorId(combinedOutput(simulatorList), config.ios.simulator);
  if (simulatorList.status !== 0 || !simulatorId) {
    const detail = redactor.redact(
      simulatorList.timedOut
        ? "Timed out while resolving the simulator id."
        : combinedOutput(simulatorList) || `Could not find simulator named ${config.ios.simulator}.`,
    );
    return blockedRecord(qaCase, startedAt, "The simulator id could not be resolved.", detail);
  }

  const build = await runProcess("xcodebuildmcp", buildArgs(config, simulatorId), {
    cwd,
    env: process.env,
    verbose,
    redactor,
    timeoutMs: 20 * 60 * 1000,
  });

  if (build.status !== 0) {
    const detail = redactor.redact(
      build.timedOut ? "Timed out while building the app." : combinedOutput(build) || "Unknown build error",
    );
    return blockedRecord(qaCase, startedAt, "The app could not be built before QA execution.", detail);
  }

  const appPathResult = await runProcess("xcodebuildmcp", getAppPathArgs(config, simulatorId), {
    cwd,
    env: process.env,
    verbose,
    redactor,
    timeoutMs: 2 * 60 * 1000,
  });
  const appPath = parseAppPath(combinedOutput(appPathResult));
  if (appPathResult.status !== 0 || !appPath) {
    const detail = redactor.redact(
      appPathResult.timedOut
        ? "Timed out while resolving the app path."
        : combinedOutput(appPathResult) || "Could not parse app path.",
    );
    return blockedRecord(qaCase, startedAt, "The built app path could not be resolved.", detail);
  }

  const install = await runProcess("xcodebuildmcp", installArgs(config, appPath, simulatorId), {
    cwd,
    env: process.env,
    verbose,
    redactor,
    timeoutMs: 5 * 60 * 1000,
  });
  if (install.status !== 0) {
    const detail = redactor.redact(
      install.timedOut ? "Timed out while installing the app." : combinedOutput(install) || "Unknown install error",
    );
    return blockedRecord(qaCase, startedAt, "The app could not be installed before QA execution.", detail);
  }

  let bundleId = config.ios.bundle_id ?? null;
  if (!bundleId) {
    const bundle = await runProcess("xcodebuildmcp", getBundleIdArgs(appPath), {
      cwd,
      env: process.env,
      verbose,
      redactor,
      timeoutMs: 60 * 1000,
    });
    bundleId = parseBundleId(combinedOutput(bundle));
    if (bundle.status !== 0 || !bundleId) {
      const detail = redactor.redact(
        bundle.timedOut
          ? "Timed out while resolving the bundle id."
          : combinedOutput(bundle) || "Could not parse bundle id.",
      );
      return blockedRecord(qaCase, startedAt, "The app bundle id could not be resolved.", detail);
    }
  }

  const launch = await runProcess("xcodebuildmcp", launchArgs(config, bundleId, simulatorId), {
    cwd,
    env: process.env,
    verbose,
    redactor,
    timeoutMs: 2 * 60 * 1000,
  });
  if (launch.status !== 0) {
    const detail = redactor.redact(
      launch.timedOut ? "Timed out while launching the app." : combinedOutput(launch) || "Unknown launch error",
    );
    return blockedRecord(qaCase, startedAt, "The app could not be launched before QA execution.", detail);
  }

  const preparedAuth = prepareCodexAuth(config);
  try {
    const codex = new Codex({
      apiKey: preparedAuth.apiKey,
      env: preparedAuth.env,
      config: {
        sandbox_workspace_write: { network_access: false },
      },
    });

    const thread = codex.startThread({
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: config.codex.sandbox,
      approvalPolicy: "never",
      ...(config.codex.model === "default" ? {} : { model: config.codex.model }),
    });

    const prompt = buildCodexPrompt(config, qaCase, { simulatorId, bundleId });
    let rawResponse: string;

    if (verbose) {
      console.log("[codexpilot] Starting Codex SDK streamed run");
      const { events } = await thread.runStreamed(prompt, {
        outputSchema: codexOutputJsonSchema,
      });
      let finalResponse = "";
      for await (const event of events) {
        logCodexEvent(event, redactor);
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message" &&
          typeof event.item.text === "string"
        ) {
          finalResponse = event.item.text;
        }
      }
      rawResponse = finalResponse;
    } else {
      const turn = await thread.run(prompt, {
        outputSchema: codexOutputJsonSchema,
      });
      rawResponse = turn.finalResponse;
    }

    const rawFinalResponse = redactor.redact(rawResponse);
    let parsed: CodexCaseResult;
    try {
      parsed = parseCodexResult(rawResponse);
      parsed = JSON.parse(redactor.redact(JSON.stringify(parsed))) as CodexCaseResult;
    } catch (error) {
      parsed = {
        status: "blocked",
        case_id: qaCase.id,
        title: qaCase.title,
        summary: "Codex returned malformed structured output.",
        executed_steps: [],
        expected: qaCase.body,
        observed: rawFinalResponse,
        failure_reason: null,
        blocked_reason: error instanceof Error ? error.message : "Malformed Codex output",
        confidence: "high",
        evidence: [],
      };
    }

    return {
      startedAt,
      completedAt: new Date().toISOString(),
      rawFinalResponse,
      result: parsed,
    };
  } finally {
    preparedAuth.cleanup();
  }
}

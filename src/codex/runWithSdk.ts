import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { CodexPilotConfig } from "../config/schema.js";
import type { ResolvedCase } from "../cases/resolveEnv.js";
import type { Redactor } from "../security/redact.js";
import { prepareCodexAuth } from "../auth/prepareCodexHome.js";
import { buildRunArgs } from "../ios/xcodebuildmcp.js";
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
};

function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    verbose: boolean;
    redactor: Redactor;
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

    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
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

  const buildRun = await runProcess("xcodebuildmcp", buildRunArgs(config), {
    cwd,
    env: process.env,
    verbose,
    redactor,
  });

  if (buildRun.status !== 0) {
    const detail = redactor.redact(buildRun.stderr || buildRun.stdout || "Unknown build/run error");
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      rawFinalResponse: "",
      result: {
        status: "blocked",
        case_id: qaCase.id,
        title: qaCase.title,
        summary: "The app could not be built and launched before QA execution.",
        executed_steps: ["Attempted to build and launch the app with xcodebuildmcp"],
        expected: qaCase.body,
        observed: detail,
        failure_reason: null,
        blocked_reason: detail,
        confidence: "high",
        evidence: [],
      },
    };
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

    const prompt = buildCodexPrompt(config, qaCase);
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

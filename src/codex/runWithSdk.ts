import { spawnSync } from "node:child_process";
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

export async function runCaseWithSdk(
  config: CodexPilotConfig,
  qaCase: ResolvedCase,
  redactor: Redactor,
  cwd = process.cwd(),
): Promise<CaseRunRecord> {
  mkdirSync(path.resolve(cwd, config.reports.output_dir), { recursive: true });
  const startedAt = new Date().toISOString();

  const buildRun = spawnSync("xcodebuildmcp", buildRunArgs(config), {
    cwd,
    encoding: "utf8",
    env: process.env,
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

    const turn = await thread.run(buildCodexPrompt(config, qaCase), {
      outputSchema: codexOutputJsonSchema,
    });

    const rawFinalResponse = redactor.redact(turn.finalResponse);
    let parsed: CodexCaseResult;
    try {
      parsed = parseCodexResult(turn.finalResponse);
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

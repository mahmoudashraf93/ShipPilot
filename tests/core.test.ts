import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configSchema, type ShipPilotConfig } from "../src/config/schema.js";
import { parseCase } from "../src/cases/parseCase.js";
import { resolveCaseEnv } from "../src/cases/resolveEnv.js";
import { logCodexEvent } from "../src/codex/runWithSdk.js";
import { createRedactor } from "../src/security/redact.js";
import { assertTrustedRunnerForSecrets } from "../src/security/trustedRunner.js";
import { summarizeStatus } from "../src/reports/jsonReport.js";
import { renderMarkdownReport } from "../src/reports/markdownReport.js";
import { renderJunitReport } from "../src/reports/junitReport.js";
import type { RunReport } from "../src/reports/jsonReport.js";

const baseConfig: ShipPilotConfig = configSchema.parse({
  codex: { auth: "api_key" },
  ios: { project: "App.xcodeproj", scheme: "App" },
});

function writeGitHubEvent(dir: string, headRepo: string, baseRepo: string): string {
  const eventPath = path.join(dir, "event.json");
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: {
        head: { repo: { full_name: headRepo } },
        base: { repo: { full_name: baseRepo } },
      },
    }),
  );
  return eventPath;
}

function transformedSecrets(secret: string): string[] {
  return [
    secret,
    `'${secret.replaceAll("'", "'\\''")}'`,
    JSON.stringify(secret).slice(1, -1),
    encodeURIComponent(secret),
    secret.replace(/([\\\s"'$`!&|;<>(){}[\]*?~#=])/g, "\\$1"),
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("config schema", () => {
  it("requires exactly one project or workspace", () => {
    expect(() =>
      configSchema.parse({
        ios: { project: "App.xcodeproj", workspace: "App.xcworkspace", scheme: "App" },
      }),
    ).toThrow(/exactly one/);
  });

  it("requires explicit opt-in for experimental hosted ChatGPT auth", () => {
    expect(() =>
      configSchema.parse({
        codex: { auth: "chatgpt_hosted_experimental" },
        ios: { project: "App.xcodeproj", scheme: "App" },
      }),
    ).toThrow(/chatgpt_hosted_experimental/);
  });
});

describe("QA cases", () => {
  it("parses front matter and resolves required env placeholders", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-test-"));
    writeFileSync(
      path.join(dir, "login.md"),
      `---
id: login
title: Login
required_env:
  - TEST_EMAIL
---

Enter \${TEST_EMAIL}.
`,
    );

    const qaCase = parseCase(path.join(dir, "login.md"));
    const resolved = resolveCaseEnv(qaCase, { TEST_EMAIL: "user@example.com" });

    expect(resolved.id).toBe("login");
    expect(resolved.resolvedBody).toContain("user@example.com");
  });
});

describe("redaction", () => {
  it("redacts configured secrets", () => {
    const redactor = createRedactor(["secret-password"]);
    expect(redactor.redact("value=secret-password")).toBe("value=[REDACTED]");
  });

  it("redacts transformed secret values", () => {
    const secret = `pa$$ word'"/?:@`;
    const redactor = createRedactor([secret]);
    const output = redactor.redact(transformedSecrets(secret).join("\n"));

    for (const transformed of transformedSecrets(secret)) {
      expect(output).not.toContain(transformed);
    }
  });

  it("redacts command strings in Codex streamed events", () => {
    const secret = "secret-password";
    const redactor = createRedactor([secret]);
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
      logs.push(String(message));
    });

    logCodexEvent(
      { type: "item.started", item: { type: "command_execution", command: `xcrun simctl type booted ${secret}` } },
      redactor,
    );
    logCodexEvent(
      {
        type: "item.completed",
        item: {
          type: "command_execution",
          status: "completed",
          exit_code: 0,
          command: `xcrun simctl type booted ${secret}`,
        },
      },
      redactor,
    );

    const output = logs.join("\n");
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
  });

  it("keeps transformed secrets out of rendered report content", () => {
    const secret = `pa$$ word'"/?:@`;
    const redactor = createRedactor([secret]);
    const redactedResult = JSON.parse(
      redactor.redact(
        JSON.stringify({
          status: "failed",
          case_id: "login",
          title: "Login",
          summary: `saw ${secret}`,
          executed_steps: [`typed ${encodeURIComponent(secret)}`],
          expected: `expected ${secret}`,
          observed: `observed ${secret}`,
          failure_reason: `failed ${secret}`,
          blocked_reason: null,
          confidence: "high",
          evidence: [],
        }),
      ),
    );
    const report: RunReport = {
      status: "failed",
      started_at: "",
      completed_at: "",
      cases: [{ startedAt: "", completedAt: "", rawFinalResponse: "", result: redactedResult }],
    };
    const output = [JSON.stringify(report), renderMarkdownReport(report), renderJunitReport(report)].join("\n");

    for (const transformed of transformedSecrets(secret)) {
      expect(output).not.toContain(transformed);
    }
  });
});

describe("trusted runner guard", () => {
  it("blocks GitHub fork PRs when secrets are present", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-gh-event-"));
    const eventPath = writeGitHubEvent(dir, "contributor/ShipPilot", "mahmoudashraf93/ShipPilot");

    expect(() =>
      assertTrustedRunnerForSecrets({
        config: baseConfig,
        hasCaseSecrets: true,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request_target",
          GITHUB_EVENT_PATH: eventPath,
          OPENAI_API_KEY: "secret",
        },
      }),
    ).toThrow(/forks/);
  });

  it("allows same-repo GitHub PRs when secrets are present", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-gh-event-"));
    const eventPath = writeGitHubEvent(dir, "mahmoudashraf93/ShipPilot", "mahmoudashraf93/ShipPilot");

    expect(() =>
      assertTrustedRunnerForSecrets({
        config: baseConfig,
        hasCaseSecrets: true,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          OPENAI_API_KEY: "secret",
        },
      }),
    ).not.toThrow();
  });

  it("allows fork PRs with the explicit override", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-gh-event-"));
    const eventPath = writeGitHubEvent(dir, "contributor/ShipPilot", "mahmoudashraf93/ShipPilot");

    expect(() =>
      assertTrustedRunnerForSecrets({
        config: baseConfig,
        hasCaseSecrets: true,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request_target",
          GITHUB_EVENT_PATH: eventPath,
          OPENAI_API_KEY: "secret",
          SHIPPILOT_ALLOW_UNTRUSTED_SECRETS: "true",
        },
      }),
    ).not.toThrow();
  });

  it("fails closed for malformed GitHub PR payloads when secrets are present", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-gh-event-"));
    const eventPath = path.join(dir, "event.json");
    writeFileSync(eventPath, JSON.stringify({ pull_request: {} }));

    expect(() =>
      assertTrustedRunnerForSecrets({
        config: baseConfig,
        hasCaseSecrets: true,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: eventPath,
          OPENAI_API_KEY: "secret",
        },
      }),
    ).toThrow(/cannot be verified/);
  });

  it("allows malformed GitHub PR payloads when no secrets are present", () => {
    expect(() =>
      assertTrustedRunnerForSecrets({
        config: baseConfig,
        hasCaseSecrets: false,
        env: {
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_EVENT_PATH: "/does/not/exist",
        },
      }),
    ).not.toThrow();
  });
});

describe("report status", () => {
  it("prefers failed over blocked over passed", () => {
    expect(
      summarizeStatus([
        {
          startedAt: "",
          completedAt: "",
          rawFinalResponse: "",
          result: {
            status: "blocked",
            case_id: "a",
            title: "A",
            summary: "",
            executed_steps: [],
            expected: "",
            observed: "",
            failure_reason: null,
            blocked_reason: "blocked",
            confidence: "high",
            evidence: [],
          },
        },
        {
          startedAt: "",
          completedAt: "",
          rawFinalResponse: "",
          result: {
            status: "failed",
            case_id: "b",
            title: "B",
            summary: "",
            executed_steps: [],
            expected: "",
            observed: "",
            failure_reason: "failed",
            blocked_reason: null,
            confidence: "high",
            evidence: [],
          },
        },
      ]),
    ).toBe("failed");
  });
});

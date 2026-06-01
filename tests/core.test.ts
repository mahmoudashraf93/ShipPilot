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
import { buildCodexPrompt } from "../src/codex/promptBuilder.js";
import {
  bootStatusWarning,
  buildCodexCliConfig,
  buildCodexProcessEnv,
  isSimulatorAlreadyBooted,
} from "../src/codex/runWithSdk.js";
import {
  buildSimulatorBridgeCommand,
  simulatorBridgeToolInputSchemas,
  simulatorBridgeToolNames,
} from "../src/ios/simulatorBridge.js";
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
  it("defaults Codex sandbox to workspace-write", () => {
    expect(baseConfig.codex.sandbox).toBe("workspace-write");
  });

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

describe("Codex prompt and runtime config", () => {
  it("uses ShipPilot simulator tools without exposing raw xcodebuildmcp commands", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-prompt-"));
    const casePath = path.join(dir, "login.md");
    writeFileSync(
      casePath,
      `---
id: login
title: Login
required_env:
  - TEST_EMAIL
---

Enter \${TEST_EMAIL}.
`,
    );

    const qaCase = resolveCaseEnv(parseCase(casePath), { TEST_EMAIL: "user@example.com" });
    const prompt = buildCodexPrompt(baseConfig, qaCase, {
      simulatorId: "11111111-1111-1111-1111-111111111111",
      bundleId: "com.example.App",
    });

    expect(prompt).toContain("shippilot_simulator MCP tools");
    expect(prompt).toContain("type_env");
    expect(prompt).not.toContain("xcodebuildmcp");
    expect(prompt).not.toContain("user@example.com");
  });

  it("disables default tools and exposes only the ShipPilot simulator MCP tools", () => {
    expect(buildCodexCliConfig("http://127.0.0.1:1234/mcp")).toEqual({
      sandbox_workspace_write: { network_access: false },
      web_search: "disabled",
      tools: { default_tools_enabled: false },
      mcp_servers: {
        shippilot_simulator: {
          type: "http",
          url: "http://127.0.0.1:1234/mcp",
          enabled_tools: [...simulatorBridgeToolNames],
          default_tools_approval_mode: "approve",
          trust_level: "trusted",
        },
      },
    });
  });

  it("keeps known secrets out of the Codex process environment", () => {
    const filtered = buildCodexProcessEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      OPENAI_API_KEY: "secret",
      CODEX_ACCESS_TOKEN: "access",
      CODEX_HOME_TGZ_BASE64: "archive",
      TEST_PASSWORD: "password",
    });

    expect(filtered).toEqual({ HOME: "/tmp/home", PATH: "/usr/bin" });
  });
});

describe("simulator bridge commands", () => {
  const context = {
    simulatorId: "sim",
    bundleId: "com.example.App",
    envValues: { TEST_EMAIL: "user@example.com" },
  };

  it("publishes explicit input schemas for interactive tools", () => {
    expect(Object.keys(simulatorBridgeToolInputSchemas.tap)).toEqual(
      expect.arrayContaining(["label", "id", "x", "y", "preDelay", "postDelay"]),
    );
    expect(Object.keys(simulatorBridgeToolInputSchemas.type_text)).toEqual(["text"]);
    expect(Object.keys(simulatorBridgeToolInputSchemas.type_env)).toEqual(["name"]);
    expect(Object.keys(simulatorBridgeToolInputSchemas.swipe)).toEqual(
      expect.arrayContaining(["x1", "y1", "x2", "y2"]),
    );
  });

  it("injects fixed simulator and bundle ids", () => {
    expect(buildSimulatorBridgeCommand("snapshot_ui", {}, context).args).toEqual([
      "simulator",
      "snapshot-ui",
      "--simulator-id",
      "sim",
    ]);
    expect(buildSimulatorBridgeCommand("launch_app", {}, context).args).toEqual([
      "simulator",
      "launch-app",
      "--simulator-id",
      "sim",
      "--bundle-id",
      "com.example.App",
    ]);
  });

  it("validates tap selector shape", () => {
    expect(() => buildSimulatorBridgeCommand("tap", { label: "Add", id: "add" }, context)).toThrow(/exactly one/);
    expect(() => buildSimulatorBridgeCommand("tap", { x: 1 }, context)).toThrow(/y/);
    expect(buildSimulatorBridgeCommand("tap", { label: "Add" }, context).args).toEqual([
      "ui-automation",
      "tap",
      "--simulator-id",
      "sim",
      "--label",
      "Add",
    ]);
  });

  it("types only declared environment values without returning the secret", () => {
    const command = buildSimulatorBridgeCommand("type_env", { name: "TEST_EMAIL" }, context);
    expect(command.args).toEqual([
      "ui-automation",
      "type-text",
      "--simulator-id",
      "sim",
      "--text",
      "user@example.com",
    ]);
    expect(command.successText).toBe("Typed environment value TEST_EMAIL into the simulator.");
    expect(command.successText).not.toContain("user@example.com");
    expect(() => buildSimulatorBridgeCommand("type_env", { name: "TEST_PASSWORD" }, context)).toThrow(/not declared/);
  });
});

describe("simulator setup", () => {
  it("recognizes an already-booted simulator as a recoverable boot result", () => {
    expect(
      isSimulatorAlreadyBooted({
        status: 1,
        stdout: "",
        stderr: "Unable to boot device in current state: Booted",
        timedOut: false,
      }),
    ).toBe(true);
  });

  it("treats bootstatus timeouts after boot as recoverable", () => {
    expect(
      bootStatusWarning({
        status: null,
        stdout: "",
        stderr: "",
        timedOut: true,
      }),
    ).toMatch(/continuing to build and launch/);
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

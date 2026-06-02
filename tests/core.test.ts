import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  launchTimeoutWarning,
} from "../src/codex/runWithSdk.js";
import {
  buildSimulatorBridgeCommand,
  simulatorBridgeToolInputSchemas,
  simulatorBridgeToolNames,
} from "../src/ios/simulatorBridge.js";
import { renderMarkdownReport } from "../src/reports/markdownReport.js";
import { renderJunitReport } from "../src/reports/junitReport.js";
import type { RunReport } from "../src/reports/jsonReport.js";
import {
  decodeWallEntries,
  lookupAppStoreApp,
  loadWallEntries,
  renderWallJson,
  renderWallMarkdown,
  submitWallEntry,
  updateReadmeWallSection,
  wallEndMarker,
  wallStartMarker,
} from "../src/wall/wall.js";

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

  it("treats launch timeouts after install as recoverable", () => {
    expect(launchTimeoutWarning()).toMatch(/use the launch_app tool if needed/);
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

describe("Wall of Apps", () => {
  const readmeWithMarkers = `# ShipPilot

## Wall of Apps

${wallStartMarker}
old content
${wallEndMarker}
`;

  it("parses and renders canonical wall JSON", () => {
    const entries = decodeWallEntries(
      JSON.stringify([
        {
          app: "Beta App",
          link: "https://apps.apple.com/us/app/beta/id222",
          icon: "https://example.com/beta.png",
        },
        {
          app: "Alpha App",
          link: "https://apps.apple.com/us/app/alpha/id111",
          icon: "https://example.com/alpha.png",
        },
      ]),
    );

    expect(entries.map((entry) => entry.app)).toEqual(["Alpha App", "Beta App"]);
    expect(renderWallJson(entries)).toBe(
      `[
  {
    "app": "Alpha App",
    "link": "https://apps.apple.com/us/app/alpha/id111",
    "icon": "https://example.com/alpha.png"
  },
  {
    "app": "Beta App",
    "link": "https://apps.apple.com/us/app/beta/id222",
    "icon": "https://example.com/beta.png"
  }
]
`,
    );
  });

  it("rejects invalid and duplicate wall entries", () => {
    expect(() => decodeWallEntries("")).toThrow(/empty/);
    expect(() => decodeWallEntries(JSON.stringify([{ app: "No Icon", link: "https://example.com" }]))).toThrow(
      /icon/,
    );
    expect(() =>
      decodeWallEntries(
        JSON.stringify([
          {
            app: "One",
            link: "https://apps.apple.com/us/app/one/id123?uo=4",
            icon: "https://example.com/one.png",
          },
          {
            app: "Two",
            link: "https://apps.apple.com/gb/app/two/id123",
            icon: "https://example.com/two.png",
          },
        ]),
      ),
    ).toThrow(/Duplicate App Store app id/);
  });

  it("renders the README wall section between markers", () => {
    const rendered = updateReadmeWallSection(readmeWithMarkers, [
      {
        app: "Alpha App",
        link: "https://apps.apple.com/us/app/alpha/id111",
        icon: "https://example.com/alpha.png",
      },
    ]);

    expect(rendered).toContain(wallStartMarker);
    expect(rendered).toContain(wallEndMarker);
    expect(rendered).toContain("Alpha App");
    expect(rendered).toContain("<table>");
    expect(rendered).not.toContain("old content");
  });

  it("renders an empty wall message", () => {
    expect(renderWallMarkdown([])).toContain("No apps are on the wall yet");
  });

  it("resolves explicit local wall sources relative to cwd", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-wall-source-"));
    mkdirSync(path.join(dir, "fixtures"));
    writeFileSync(
      path.join(dir, "fixtures", "wall.json"),
      JSON.stringify([
        {
          app: "Source App",
          link: "https://example.com/source",
          icon: "https://example.com/source.png",
        },
      ]),
    );

    await expect(loadWallEntries({ source: "fixtures/wall.json", cwd: dir })).resolves.toEqual([
      {
        app: "Source App",
        link: "https://example.com/source",
        icon: "https://example.com/source.png",
      },
    ]);
  });

  it("resolves App Store metadata from lookup responses", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          resultCount: 1,
          results: [
            {
              trackName: "Lookup App",
              trackViewUrl: "https://apps.apple.com/us/app/lookup/id123",
              artworkUrl512: "https://example.com/icon.png",
            },
          ],
        }),
      );
    });

    await expect(lookupAppStoreApp("123", "us", fetchMock)).resolves.toEqual({
      app: "Lookup App",
      link: "https://apps.apple.com/us/app/lookup/id123",
      icon: "https://example.com/icon.png",
    });
  });

  it("previews submit without GitHub mutations", async () => {
    const gh = vi.fn(async () => {
      throw new Error("gh should not be called in dry-run");
    });
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.startsWith("https://itunes.apple.com/lookup")) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackName: "Preview App",
                trackViewUrl: "https://apps.apple.com/us/app/preview/id123",
                artworkUrl512: "https://example.com/preview.png",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/docs/wall-of-apps.json")) return new Response("[]");
      if (url.endsWith("/README.md")) return new Response(readmeWithMarkers);
      return new Response("not found", { status: 404 });
    });

    const result = await submitWallEntry({
      app: "123",
      dryRun: true,
      fetch: fetchMock,
      gh,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      appId: "123",
      app: "Preview App",
      changedFiles: ["docs/wall-of-apps.json", "README.md"],
      pullRequestTitle: "Add Preview App to Wall of Apps",
    });
    expect(result.branch).toBe("wall/add-123-20260601T120000z");
    expect(gh).not.toHaveBeenCalled();
  });

  it("confirmed submit updates only the allowed files before opening a PR", async () => {
    const ghCalls: string[][] = [];
    const gh = vi.fn(async (args: string[]) => {
      ghCalls.push(args);
      const joined = args.join(" ");
      if (joined === "api user --jq .login") return "tester\n";
      if (joined === "repo view tester/ShipPilot --json nameWithOwner --jq .nameWithOwner") return "tester/ShipPilot\n";
      if (joined === "api repos/mahmoudashraf93/ShipPilot/git/ref/heads/main --jq .object.sha") return "basesha\n";
      if (joined.startsWith("api -X POST repos/tester/ShipPilot/git/refs")) return "{}";
      if (
        joined ===
        "api repos/mahmoudashraf93/ShipPilot/contents/docs/wall-of-apps.json --method GET -f ref=main --jq .sha"
      ) {
        return "wallsha\n";
      }
      if (joined === "api repos/mahmoudashraf93/ShipPilot/contents/README.md --method GET -f ref=main --jq .sha") {
        return "readmesha\n";
      }
      if (joined.startsWith("api -X PUT repos/tester/ShipPilot/contents/docs/wall-of-apps.json")) return "{}";
      if (joined.startsWith("api -X PUT repos/tester/ShipPilot/contents/README.md")) return "{}";
      if (joined.startsWith("pr create --repo mahmoudashraf93/ShipPilot")) {
        return "https://github.com/mahmoudashraf93/ShipPilot/pull/1\n";
      }
      throw new Error(`unexpected gh call: ${joined}`);
    });
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/docs/wall-of-apps.json")) return new Response("[]");
      if (url.endsWith("/README.md")) return new Response(readmeWithMarkers);
      return new Response("not found", { status: 404 });
    });

    const result = await submitWallEntry({
      name: "Confirmed App",
      link: "https://example.com/confirmed",
      icon: "https://example.com/confirmed.png",
      confirm: true,
      fetch: fetchMock,
      gh,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(result.pullRequestUrl).toBe("https://github.com/mahmoudashraf93/ShipPilot/pull/1");
    const putTargets = ghCalls
      .filter((args) => args[0] === "api" && args[1] === "-X" && args[2] === "PUT")
      .map((args) => args[3]);
    expect(putTargets).toEqual([
      "repos/tester/ShipPilot/contents/docs/wall-of-apps.json",
      "repos/tester/ShipPilot/contents/README.md",
    ]);
    expect(ghCalls.flat()).not.toContain("git");
  });

  it("does not build confirmed submissions from local files when upstream fetch fails", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shippilot-wall-confirm-"));
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" }));

    await expect(
      submitWallEntry({
        name: "Confirmed App",
        link: "https://example.com/confirmed",
        icon: "https://example.com/confirmed.png",
        confirm: true,
        cwd: dir,
        fetch: fetchMock,
      }),
    ).rejects.toThrow(/Failed to fetch/);
  });

  it("requires confirm unless dry-run is set", async () => {
    await expect(submitWallEntry({ name: "Manual", link: "https://example.com", icon: "https://example.com/i.png" }))
      .rejects.toThrow(/--confirm/);
  });

  it("requires full manual entry details", async () => {
    await expect(submitWallEntry({ name: "Manual", link: "https://example.com", dryRun: true })).rejects.toThrow(
      /--name, --link, and --icon/,
    );
    await expect(
      submitWallEntry({ name: "   ", link: "https://example.com", icon: "https://example.com/i.png", dryRun: true }),
    ).rejects.toThrow(/--name, --link, and --icon/);
  });
});

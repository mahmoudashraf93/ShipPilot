import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configSchema } from "../src/config/schema.js";
import { parseCase } from "../src/cases/parseCase.js";
import { resolveCaseEnv } from "../src/cases/resolveEnv.js";
import { createRedactor } from "../src/security/redact.js";
import { summarizeStatus } from "../src/reports/jsonReport.js";

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

#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import fg from "fast-glob";
import { loadConfig } from "./config/loadConfig.js";
import { validateAuthConfig } from "./auth/validateAuth.js";
import { parseCase } from "./cases/parseCase.js";
import { resolveCaseEnv } from "./cases/resolveEnv.js";
import { createRedactor } from "./security/redact.js";
import { assertTrustedRunnerForSecrets } from "./security/trustedRunner.js";
import { doctorXcode } from "./ios/doctorXcode.js";
import { runCaseWithSdk } from "./codex/runWithSdk.js";
import { writeJsonReport, readJsonReport, type RunReport } from "./reports/jsonReport.js";
import { writeMarkdownReport } from "./reports/markdownReport.js";
import { writeJunitReport } from "./reports/junitReport.js";
import { ExitCodes } from "./exitCodes.js";

type GlobalOptions = {
  config?: string;
};

function writeReports(configPath: string | undefined, report: RunReport): void {
  const config = loadConfig(configPath);
  if (config.reports.markdown) writeMarkdownReport(config, report);
  if (config.reports.junit) writeJunitReport(config, report);
}

function exitCodeFor(report: RunReport, failOn: "failed_or_blocked" | "never"): number {
  if (failOn === "never") return ExitCodes.success;
  if (report.status === "failed") return ExitCodes.failed;
  if (report.status === "blocked") return ExitCodes.blocked;
  return ExitCodes.success;
}

function printCheck(name: string, ok: boolean, detail?: string): void {
  const marker = ok ? "PASS" : "FAIL";
  console.log(`${marker} ${name}${detail ? `: ${detail.split("\n")[0]}` : ""}`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("shippilot")
    .description("ShipPilot: agentic iOS QA runner for Codex")
    .version("0.0.2")
    .option("-c, --config <path>", "config file path", "shippilot.yml");

  program.command("init").description("Scaffold ShipPilot config, sample case, and CI templates").action(() => {
    mkdirSync("qa", { recursive: true });
    mkdirSync(".github/workflows", { recursive: true });
    mkdirSync("bitrise", { recursive: true });

    writeFileSync(
      "shippilot.yml",
      `codex:
  engine: sdk
  auth: api_key
  model: default
  sandbox: danger-full-access
  fail_on: failed_or_blocked
  allow_experimental_personal_hosted_auth: false
  verbose: false

ios:
  project: MyApp.xcodeproj
  bundle_id:
  scheme: MyApp
  simulator: iPhone 17 Pro
  backend: xcodebuildmcp
  configuration: Debug

reports:
  output_dir: .shippilot
  markdown: true
  json: true
  junit: true
  screenshots: true
`,
    );

    writeFileSync(
      "qa/login.md",
      `---
id: login-happy-path
title: Login happy path
required_env:
  - TEST_EMAIL
  - TEST_PASSWORD
tags:
  - release
  - smoke
---

Launch the app.
Enter \${TEST_EMAIL} and \${TEST_PASSWORD}.
Tap Log In.
Expect the Home screen to be visible.
`,
    );

    writeFileSync(
      ".github/workflows/shippilot.yml",
      `name: ShipPilot QA

on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  shippilot:
    runs-on: macos-15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Run ShipPilot
        env:
          OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
          TEST_EMAIL: \${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: \${{ secrets.TEST_PASSWORD }}
        run: |
          npx shippilot doctor
          npx shippilot run --case qa/login.md

      - name: Upload ShipPilot report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shippilot-report
          path: .shippilot/
`,
    );

    writeFileSync(
      "bitrise/shippilot.sh",
      `#!/usr/bin/env bash
set -euo pipefail

npm install -g shippilot
shippilot doctor
shippilot run --case qa/login.md
`,
      { mode: 0o755 },
    );

    console.log("Created shippilot.yml, qa/login.md, and CI templates.");
  });

  program.command("doctor").description("Validate config, auth, Xcode, XcodeBuildMCP, and project inputs").action(() => {
    const options = program.opts<GlobalOptions>();
    try {
      const config = loadConfig(options.config);
      const authIssues = validateAuthConfig(config);
      for (const issue of authIssues) printCheck("auth", false, issue);

      const checks = doctorXcode(config);
      for (const check of checks) printCheck(check.name, check.ok, check.detail);

      if (authIssues.length > 0 || checks.some((check) => !check.ok)) {
        process.exitCode = ExitCodes.setupError;
        return;
      }

      printCheck("ShipPilot doctor", true, "ready");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = ExitCodes.setupError;
    }
  });

  program
    .command("run")
    .description("Run one or more ShipPilot QA cases")
    .option("--case <path>", "single QA case Markdown file")
    .option("--cases <glob>", "QA case glob or directory")
    .option("--verbose", "stream XcodeBuildMCP and Codex SDK events")
    .action(async (runOptions: { case?: string; cases?: string; verbose?: boolean }) => {
      const options = program.opts<GlobalOptions>();
      const startedAt = new Date().toISOString();

      try {
        const config = loadConfig(options.config);
        const authIssues = validateAuthConfig(config);
        if (authIssues.length > 0) throw new Error(authIssues.join("\n"));

        const casePaths = runOptions.case
          ? [runOptions.case]
          : await fg(runOptions.cases ? `${runOptions.cases.replace(/\/$/, "")}/**/*.md` : "qa/**/*.md");

        if (casePaths.length === 0) throw new Error("No QA cases found.");

        const records = [];
        for (const casePath of casePaths) {
          const qaCase = parseCase(casePath);
          const resolved = resolveCaseEnv(qaCase);
          assertTrustedRunnerForSecrets({
            config,
            hasCaseSecrets: Object.values(resolved.envValues).some((value) => value.length > 0),
          });
          const redactor = createRedactor(Object.values(resolved.envValues));
          console.log(`Running ${qaCase.id}: ${qaCase.title}`);
          records.push(
            await runCaseWithSdk(config, resolved, redactor, process.cwd(), runOptions.verbose ?? config.codex.verbose),
          );
        }

        const report = writeJsonReport(config, records, startedAt);
        if (config.reports.markdown) writeMarkdownReport(config, report);
        if (config.reports.junit) writeJunitReport(config, report);
        console.log(`ShipPilot completed with status: ${report.status}`);
        process.exitCode = exitCodeFor(report, config.codex.fail_on);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = ExitCodes.setupError;
      }
    });

  program
    .command("report")
    .description("Regenerate reports from a saved run.json")
    .requiredOption("--run <path>", "path to run.json")
    .action((reportOptions: { run: string }) => {
      const options = program.opts<GlobalOptions>();
      try {
        const report = readJsonReport(reportOptions.run);
        writeReports(options.config, report);
        console.log("Regenerated ShipPilot reports.");
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = ExitCodes.setupError;
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = ExitCodes.setupError;
});

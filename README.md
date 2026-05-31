# ShipPilot

ShipPilot is an open-source agentic QA runner for iOS apps. It lets teams write Markdown QA cases, run them from GitHub Actions, Bitrise, or local CI, and fail the pipeline when Codex cannot verify the expected app behavior.

The v1 runner is intentionally test-and-report only. It does not edit source files, create patches, commit, push, or open pull requests.

## Quick Start

Prerequisites:

- macOS with Xcode for simulator runs.
- Node.js 20+.
- XcodeBuildMCP CLI, for example `npm install -g xcodebuildmcp`.

```bash
npx shippilot init
npx shippilot doctor
npx shippilot run --case qa/login.md
```

Add secrets to CI for app test credentials and one Codex auth mode:

- `OPENAI_API_KEY` for hosted CI and OpenAI Platform billing.
- `CODEX_ACCESS_TOKEN` for trusted Business/Enterprise automation.
- `CODEX_HOME_TGZ_BASE64` only for the experimental personal ChatGPT hosted-runner flow.

## Config

ShipPilot reads `shippilot.yml` by default.

```yaml
codex:
  engine: sdk
  auth: api_key # api_key | access_token | chatgpt_hosted_experimental
  model: default
  sandbox: danger-full-access
  fail_on: failed_or_blocked
  verbose: false
  allow_experimental_personal_hosted_auth: false

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
  logs: true
```

Use either `ios.project` or `ios.workspace`, not both.

`danger-full-access` is required for simulator UI automation because XcodeBuildMCP needs access to CoreSimulator services outside the repository workspace. Run ShipPilot only in trusted workflows and never with secrets on arbitrary fork PRs.

## QA Case

```md
---
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
Enter `${TEST_EMAIL}` and `${TEST_PASSWORD}`.
Tap Log In.
Expect the Home screen to be visible.
```

Environment placeholders are resolved at runtime and redacted from prompts, logs, reports, and artifacts.

## CI Failure Semantics

ShipPilot exits like a test runner:

- `0`: all cases passed
- `1`: at least one case failed
- `2`: setup/auth/project/simulator/config error
- `3`: at least one case was blocked or inconclusive

Set `codex.fail_on: never` for report-only mode.

Use `codex.verbose: true` or `shippilot run --verbose` to stream XcodeBuildMCP output and Codex SDK events in CI logs. Verbose mode shows progress, tool calls, command executions, reasoning summaries, errors, and token usage, but not private model chain-of-thought.

## GitHub Actions

```yaml
name: ShipPilot QA

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
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          CODEX_ACCESS_TOKEN: ${{ secrets.CODEX_ACCESS_TOKEN }}
          CODEX_HOME_TGZ_BASE64: ${{ secrets.CODEX_HOME_TGZ_BASE64 }}
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
        run: |
          npx shippilot doctor
          npx shippilot run --case qa/login.md

      - name: Upload ShipPilot report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: shippilot-report
          path: .shippilot/
```

Do not run secret-backed workflows on arbitrary fork PRs.

## Reports

Reports are written to `.shippilot/`:

```text
.shippilot/
  run.json
  report.md
  junit.xml
  logs/
  screenshots/
```

## Documentation

- [Full plan](docs/plan.md)
- [Auth modes](docs/auth.md)
- [GitHub Actions](docs/github-actions.md)
- [Bitrise](docs/bitrise.md)
- [Personal ChatGPT subscription](docs/personal-chatgpt-subscription.md)
- [Security](docs/security.md)

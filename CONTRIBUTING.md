# Contributing To ShipPilot

Thanks for helping improve ShipPilot.

ShipPilot is an open-source agentic QA runner for mobile apps. Contributions should keep the CLI focused on running QA cases and writing reports. Avoid features that let the CI agent edit source files, commit, push, or open pull requests unless that behavior is explicitly designed behind a separate mode.

## Local Setup

Prerequisites:

- Node.js 20 or newer.
- npm.
- macOS with Xcode for iOS simulator flows.

Install dependencies:

```bash
npm ci
```

Run checks:

```bash
npm run typecheck
npm test
npm run build
```

Check the npm package contents before release-related changes:

```bash
npm pack --dry-run
```

## Pull Requests

Before opening a pull request:

- Keep changes scoped to one behavior or documentation improvement.
- Add or update tests for parser, config, report, or redaction behavior.
- Update docs and examples when CLI behavior changes.
- Do not commit `dist/`, `.shippilot/`, `.codex/`, local secrets, simulator output, or package tarballs.

Useful areas to improve:

- Config validation and clearer doctor checks.
- QA case parsing and secret redaction.
- Report quality and artifact collection.
- XcodeBuildMCP integration robustness.
- CI examples for common hosted runners.

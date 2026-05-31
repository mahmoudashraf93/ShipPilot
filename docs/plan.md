# CodexPilot iOS Full Project Plan

CodexPilot iOS is an SDK-first agentic iOS QA runner. Teams write Markdown QA cases, configure an iOS project and simulator, choose a Codex auth mode, and run the tool from GitHub Actions, Bitrise, or local CI. Codex drives the app through an iOS simulator, verifies expected outcomes, captures screenshots/logs, writes reports, and fails CI when a case fails.

## Core Design

- TypeScript/Node CLI published as `codexpilot-ios`.
- Product name: CodexPilot iOS.
- GitHub repo: `mahmoudashraf93/CodexPilot-iOS`.
- Primary engine: `@openai/codex-sdk`.
- iOS automation backend: XcodeBuildMCP CLI.
- v1 is test-and-report only: no edits, commits, patches, pushes, or PR creation.
- `codex app-server` is reserved for future advanced integrations.

## CLI

```bash
npx codexpilot-ios init
npx codexpilot-ios doctor
npx codexpilot-ios run --case qa/login.md
npx codexpilot-ios run --cases qa/
npx codexpilot-ios report --run .codexpilot-ios/run.json
```

## Auth Modes

- `api_key`: uses `OPENAI_API_KEY`, recommended for hosted CI.
- `access_token`: uses `CODEX_ACCESS_TOKEN`, recommended for trusted Business/Enterprise automation.
- `chatgpt_hosted_experimental`: restores a pre-authenticated Codex home from `CODEX_HOME_TGZ_BASE64`; fragile and not recommended for fork PRs.

## CI Semantics

- `passed` exits `0`.
- `failed` exits `1`.
- setup/auth/config/simulator errors exit `2`.
- `blocked` exits `3`.

`codex.fail_on: never` enables report-only mode.

`codex.verbose: true` or `codexpilot-ios run --verbose` streams build output and Codex SDK events for CI debugging. It shows reasoning summaries and tool activity, not private chain-of-thought.

## Milestones

1. Create public repo and initial docs.
2. Scaffold TypeScript CLI.
3. Implement config and QA case parsing.
4. Implement auth validation and redaction.
5. Implement XcodeBuildMCP doctor checks.
6. Implement Codex SDK execution.
7. Implement reports and exit codes.
8. Add GitHub Actions and Bitrise examples.
9. Add sample iOS app and smoke cases.
10. Publish initial npm package as `codexpilot-ios`.

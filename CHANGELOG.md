# Changelog

All notable changes to ShipPilot will be documented in this file.

## 0.1.1 - 2026-06-02

### Added

- Added the Wall of Apps source data, README gallery section, listing command, and App Store-backed submission flow.
- Added `shippilot wall submit --dry-run` previews and `--confirm` GitHub pull request creation through an authenticated `gh` session.

### Changed

- Continued QA setup after simulator launch timeouts so agents can relaunch the app when needed.
- Tightened simulator bridge and prompt wording around the QA tool allowlist.

## 0.1.0 - 2026-06-01

### Added

- Added the ShipPilot simulator MCP bridge so Codex QA runs only receive a small allowlist of simulator tools.
- Added explicit MCP input schemas for simulator UI tools such as tap, screenshot, swipe, text entry, and app launch controls.
- Added trusted-runner checks for secret-backed GitHub Actions runs.
- Added stronger secret redaction, including transformed secret values.

### Changed

- Disabled default Codex tools and web search during QA execution.
- Updated QA prompts and security docs to treat QA case text, app UI, screenshots, logs, and files as untrusted data.
- Treat already-booted simulators as a recoverable setup condition.
- Normalized the package bin path.

## 0.0.2 - 2026-05-31

### Changed

- Removed the unused `reports.logs` config option from docs, examples, and generated config.
- Clarified that verbose mode streams redacted terminal output rather than writing log artifacts.
- Updated CI to run pull request checks on Node.js 20 and 22 with build, test, typecheck, and package validation.
- Updated README icon rendering so it works from npm without increasing package size.

## 0.0.1 - 2026-05-31

### Added

- Initial public npm release of the `shippilot` CLI.
- Markdown QA case parsing with required environment variable checks.
- Codex SDK execution path for agentic iOS QA runs.
- XcodeBuildMCP-backed iOS simulator doctor and run support.
- JSON, Markdown, and JUnit report output.
- GitHub Actions and Bitrise usage examples.
- npm release workflow for future trusted publishing releases.

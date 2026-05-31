# Changelog

All notable changes to ShipPilot will be documented in this file.

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

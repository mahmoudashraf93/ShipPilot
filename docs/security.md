# Security

CodexPilot iOS is designed for open-source CI, so secret handling is strict by default.

## Defaults

- Do not run secret-backed workflows on arbitrary fork PRs.
- Use `actions/checkout` with `persist-credentials: false`.
- Do not cache Codex auth by default.
- Keep auth material in temporary directories.
- Upload reports with `if: always()`, but never upload auth folders.

## Redaction

Values declared in QA case `required_env` are redacted from:

- generated prompts
- SDK output
- logs
- Markdown reports
- JSON reports
- JUnit reports

## Never Upload

- restored `CODEX_HOME`
- `.codex`
- `auth.json`
- API keys
- access tokens
- restored auth archives

## Test Scope

v1 is test-and-report only. It instructs Codex not to edit source files, create patches, commit, push, or open pull requests.

## Simulator Sandbox

XcodeBuildMCP needs access to CoreSimulator services outside the repository workspace. For iOS simulator UI automation, set `codex.sandbox: danger-full-access` and run only in trusted CI contexts such as `workflow_dispatch`, release, schedule, or maintainer-approved workflows.

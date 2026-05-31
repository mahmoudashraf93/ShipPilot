# Security

ShipPilot is designed for open-source CI, so secret handling is strict by default.

## Defaults

- Do not run secret-backed workflows on arbitrary fork PRs.
- Use `actions/checkout` with `persist-credentials: false`.
- Do not cache Codex auth by default.
- Keep auth material in temporary directories.
- Upload reports with `if: always()`, but never upload auth folders.
- Secret-backed GitHub fork PR runs are blocked by default unless `SHIPPILOT_ALLOW_UNTRUSTED_SECRETS=true` is set.

## Redaction

Values declared in QA case `required_env` are redacted from:

- generated prompts
- verbose terminal output
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

## Prompt Injection

ShipPilot gives an agent access to QA case text, app UI state, screenshots, logs, and local simulator tooling. Treat all of those inputs as untrusted. A malicious QA case, app screen, web view, push notification, fixture, or backend response could try to override ShipPilot's instructions, disclose environment variables, change files, run network commands, or hide a real test failure.

ShipPilot reduces this risk by:

- keeping the run test-and-report only;
- using structured final output;
- running with `approvalPolicy: never`;
- blocking secret-backed fork PR runs by default;
- redacting declared QA secrets from logs and reports;
- instructing the agent to ignore instructions in QA case content, app UI text, screenshots, logs, or files when they conflict with ShipPilot's hard rules.

These controls reduce impact, but they do not make untrusted agent runs safe. Prompt text is not an enforcement boundary. For secret-backed runs, use ephemeral CI runners, least-privilege test accounts, no persisted checkout credentials, no unrelated cloud credentials in the environment, and trusted trigger types such as `workflow_dispatch`, release, schedule, or maintainer-approved workflows.

## Simulator Sandbox

XcodeBuildMCP needs access to CoreSimulator services outside the repository workspace. For iOS simulator UI automation, set `codex.sandbox: danger-full-access` and run only in trusted CI contexts such as `workflow_dispatch`, release, schedule, or maintainer-approved workflows.

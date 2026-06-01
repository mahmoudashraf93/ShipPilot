# Security

ShipPilot is designed for open-source CI, so secret handling is strict by default.

## Defaults

- Do not run secret-backed workflows on arbitrary fork PRs.
- Use `actions/checkout` with `persist-credentials: false`.
- Do not cache Codex auth by default.
- Keep auth material in temporary directories.
- Upload reports with `if: always()`, but never upload auth folders.
- Run Codex with `workspace-write` by default.
- Disable Codex default tools during QA execution and expose only the ShipPilot simulator bridge.
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
- disabling Codex default tools during QA execution;
- disabling web search and network access in the Codex QA sandbox;
- exposing simulator actions only through a ShipPilot-controlled MCP bridge;
- not exposing shell, git, filesystem, dependency install, arbitrary command, or raw XcodeBuildMCP tools to the QA agent;
- binding simulator bridge actions to the ShipPilot-selected simulator and app bundle id;
- typing declared secret values through `type_env` without printing those values back to the agent;
- instructing the agent to ignore instructions in QA case content, app UI text, screenshots, logs, or files when they conflict with ShipPilot's hard rules.

These controls reduce impact, but they do not make untrusted agent runs safe. Prompt text is not an enforcement boundary. For secret-backed runs, use ephemeral CI runners, least-privilege test accounts, no persisted checkout credentials, no unrelated cloud credentials in the environment, and trusted trigger types such as `workflow_dispatch`, release, schedule, or maintainer-approved workflows.

## Simulator Sandbox

ShipPilot runs setup/build/install/launch itself, then keeps Codex in `workspace-write` by default. Simulator UI actions are exposed through the ShipPilot simulator MCP bridge, which maps a small allowlist of QA tools to XcodeBuildMCP. During the QA turn, this local bridge is the only MCP server ShipPilot configures, its tools publish explicit input schemas, and its allowlisted tools are auto-approved so non-interactive CI does not fall back to cancelled tool calls. `danger-full-access` remains an explicit escape hatch and should only be used in trusted CI contexts such as `workflow_dispatch`, release, schedule, or maintainer-approved workflows.

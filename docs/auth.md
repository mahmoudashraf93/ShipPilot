# Auth

ShipPilot supports three auth modes.

## `api_key`

Use `OPENAI_API_KEY`.

This is the recommended default for GitHub-hosted runners, Bitrise, and open-source projects. It uses OpenAI Platform/API billing.

```yaml
codex:
  auth: api_key
```

## `access_token`

Use `CODEX_ACCESS_TOKEN`.

This is intended for trusted Business/Enterprise automation where teams want workspace identity and governance.

```yaml
codex:
  auth: access_token
```

ShipPilot bootstraps Codex with:

```bash
printenv CODEX_ACCESS_TOKEN | codex login --with-access-token
```

## `chatgpt_hosted_experimental`

This experimental mode restores a pre-authenticated Codex home from a secret. It is intended only for local or explicitly trusted runners.

```yaml
codex:
  auth: chatgpt_hosted_experimental
  allow_experimental_personal_hosted_auth: true
```

Required secret:

- `CODEX_HOME_TGZ_BASE64`

This is fragile, sensitive, and not recommended for hosted CI or public fork PR workflows. Prefer `api_key` with `OPENAI_API_KEY` for generated GitHub Actions workflows.

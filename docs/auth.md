# Auth

CodexPilot iOS supports three auth modes.

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

CodexPilot iOS bootstraps Codex with:

```bash
printenv CODEX_ACCESS_TOKEN | codex login --with-access-token
```

## `chatgpt_hosted_experimental`

This mode attempts personal ChatGPT subscription auth on GitHub-hosted runners by restoring a pre-authenticated Codex home from a secret.

```yaml
codex:
  auth: chatgpt_hosted_experimental
  allow_experimental_personal_hosted_auth: true
```

Required secret:

- `CODEX_HOME_TGZ_BASE64`

This is fragile, sensitive, and not recommended for public fork PR workflows.

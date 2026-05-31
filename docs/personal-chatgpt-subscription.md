# Personal ChatGPT Subscription

The clean hosted-CI path is `OPENAI_API_KEY`. Personal ChatGPT subscription auth is browser/session based and is not a first-class hosted CI credential.

ShipPilot supports one experimental hosted-runner path:

1. Log in locally:
   ```bash
   codex login
   codex login status
   ```
2. Archive your Codex home:
   ```bash
   tar -czf codex-home.tgz ~/.codex
   base64 -i codex-home.tgz | pbcopy
   ```
3. Store the result as `CODEX_HOME_TGZ_BASE64` in GitHub Secrets.
4. Enable:
   ```yaml
   codex:
     auth: chatgpt_hosted_experimental
     allow_experimental_personal_hosted_auth: true
   ```

Warnings:

- The login can expire.
- The auth storage format can change.
- Treat `CODEX_HOME_TGZ_BASE64` like a highly sensitive credential.
- Never use this on untrusted fork PRs.
- Never upload `.codex`, `auth.json`, restored auth folders, or temporary archives.

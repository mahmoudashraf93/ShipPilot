import type { CodexPilotConfig } from "../config/schema.js";

export function validateAuthConfig(config: CodexPilotConfig, env = process.env): string[] {
  const issues: string[] = [];

  if (config.codex.auth === "api_key" && !env.OPENAI_API_KEY) {
    issues.push("OPENAI_API_KEY is required for codex.auth: api_key.");
  }

  if (config.codex.auth === "access_token" && !env.CODEX_ACCESS_TOKEN) {
    issues.push("CODEX_ACCESS_TOKEN is required for codex.auth: access_token.");
  }

  if (config.codex.auth === "chatgpt_hosted_experimental") {
    if (!config.codex.allow_experimental_personal_hosted_auth) {
      issues.push(
        "chatgpt_hosted_experimental requires allow_experimental_personal_hosted_auth: true.",
      );
    }
    if (!env.CODEX_HOME_TGZ_BASE64) {
      issues.push("CODEX_HOME_TGZ_BASE64 is required for chatgpt_hosted_experimental.");
    }
  }

  return issues;
}

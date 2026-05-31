import { readFileSync } from "node:fs";
import type { ShipPilotConfig } from "../config/schema.js";

type TrustedRunnerEnv = NodeJS.ProcessEnv;

type PullRequestPayload = {
  pull_request?: {
    head?: { repo?: { full_name?: unknown } };
    base?: { repo?: { full_name?: unknown } };
  };
};

export function hasActiveAuthSecret(config: ShipPilotConfig, env: TrustedRunnerEnv = process.env): boolean {
  if (config.codex.auth === "api_key") return Boolean(env.OPENAI_API_KEY);
  if (config.codex.auth === "access_token") return Boolean(env.CODEX_ACCESS_TOKEN);
  if (config.codex.auth === "chatgpt_hosted_experimental") return Boolean(env.CODEX_HOME_TGZ_BASE64);
  return false;
}

function isGitHubPrEvent(env: TrustedRunnerEnv): boolean {
  return env.GITHUB_ACTIONS === "true" && ["pull_request", "pull_request_target"].includes(env.GITHUB_EVENT_NAME ?? "");
}

function isOverrideEnabled(env: TrustedRunnerEnv): boolean {
  return env.SHIPPILOT_ALLOW_UNTRUSTED_SECRETS === "true";
}

function readPullRequestRepos(eventPath: string): { headRepo: string; baseRepo: string } {
  const payload = JSON.parse(readFileSync(eventPath, "utf8")) as PullRequestPayload;
  const headRepo = payload.pull_request?.head?.repo?.full_name;
  const baseRepo = payload.pull_request?.base?.repo?.full_name;

  if (typeof headRepo !== "string" || typeof baseRepo !== "string" || !headRepo || !baseRepo) {
    throw new Error("GitHub pull request payload is missing head/base repository names.");
  }

  return { headRepo, baseRepo };
}

export function assertTrustedRunnerForSecrets(options: {
  config: ShipPilotConfig;
  hasCaseSecrets: boolean;
  env?: TrustedRunnerEnv;
}): void {
  const env = options.env ?? process.env;
  if (isOverrideEnabled(env)) return;
  if (!isGitHubPrEvent(env)) return;

  const hasSecrets = hasActiveAuthSecret(options.config, env) || options.hasCaseSecrets;
  if (!hasSecrets) return;

  try {
    const eventPath = env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      throw new Error("GITHUB_EVENT_PATH is not set.");
    }

    const { headRepo, baseRepo } = readPullRequestRepos(eventPath);
    if (headRepo === baseRepo) return;
  } catch (error) {
    throw new Error(
      `ShipPilot refuses to run secret-backed GitHub pull request workflows when fork status cannot be verified. ${
        error instanceof Error ? error.message : String(error)
      } Set SHIPPILOT_ALLOW_UNTRUSTED_SECRETS=true to override only after confirming this runner is trusted.`,
    );
  }

  throw new Error(
    "ShipPilot refuses to run secret-backed workflows on GitHub pull requests from forks. " +
      "Use workflow_dispatch, release/schedule workflows, maintainer-approved trusted runs, or set " +
      "SHIPPILOT_ALLOW_UNTRUSTED_SECRETS=true only after confirming this runner is trusted.",
  );
}

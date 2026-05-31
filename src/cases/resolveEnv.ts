import type { QaCase } from "./parseCase.js";

export type ResolvedCase = QaCase & {
  resolvedBody: string;
  envValues: Record<string, string>;
};

export function resolveCaseEnv(qaCase: QaCase, env = process.env): ResolvedCase {
  const missing = qaCase.required_env.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required env vars for ${qaCase.id}: ${missing.join(", ")}`);
  }

  const envValues = Object.fromEntries(
    qaCase.required_env.map((key) => [key, String(env[key] ?? "")]),
  );

  const resolvedBody = qaCase.body.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(envValues, key)) {
      return envValues[key];
    }
    return match;
  });

  return {
    ...qaCase,
    resolvedBody,
    envValues,
  };
}

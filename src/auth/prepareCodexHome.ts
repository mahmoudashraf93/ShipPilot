import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ShipPilotConfig } from "../config/schema.js";

export type PreparedAuth = {
  apiKey?: string;
  env: Record<string, string>;
  cleanup: () => void;
};

function stringEnv(env = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function makeTempCodexHome(): string {
  return mkdtempSync(path.join(os.tmpdir(), "shippilot-codex-home-"));
}

export function prepareCodexAuth(config: ShipPilotConfig, env = process.env): PreparedAuth {
  const baseEnv = stringEnv(env);

  if (config.codex.auth === "api_key") {
    return {
      apiKey: env.OPENAI_API_KEY,
      env: baseEnv,
      cleanup: () => undefined,
    };
  }

  if (config.codex.auth === "access_token") {
    const codexHome = makeTempCodexHome();
    const result = spawnSync("codex", ["login", "--with-access-token"], {
      input: env.CODEX_ACCESS_TOKEN,
      encoding: "utf8",
      env: { ...baseEnv, CODEX_HOME: codexHome },
    });

    if (result.status !== 0) {
      rmSync(codexHome, { recursive: true, force: true });
      throw new Error(`codex login --with-access-token failed: ${result.stderr || result.stdout}`);
    }

    return {
      env: { ...baseEnv, CODEX_HOME: codexHome },
      cleanup: () => rmSync(codexHome, { recursive: true, force: true }),
    };
  }

  const codexHome = makeTempCodexHome();
  const archivePath = path.join(os.tmpdir(), `shippilot-codex-home-${Date.now()}.tgz`);
  writeFileSync(archivePath, Buffer.from(String(env.CODEX_HOME_TGZ_BASE64), "base64"));

  const result = spawnSync("tar", ["-xzf", archivePath, "-C", codexHome, "--strip-components=1"], {
    encoding: "utf8",
  });

  rmSync(archivePath, { force: true });

  if (result.status !== 0) {
    rmSync(codexHome, { recursive: true, force: true });
    throw new Error(`Failed to restore CODEX_HOME_TGZ_BASE64: ${result.stderr || result.stdout}`);
  }

  return {
    env: { ...baseEnv, CODEX_HOME: codexHome },
    cleanup: () => rmSync(codexHome, { recursive: true, force: true }),
  };
}

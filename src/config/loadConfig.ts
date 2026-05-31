import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { configSchema, type ShipPilotConfig } from "./schema.js";

export function loadConfig(configPath = "shippilot.yml", cwd = process.cwd()): ShipPilotConfig {
  const absolutePath = path.resolve(cwd, configPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const parsed = YAML.parse(readFileSync(absolutePath, "utf8"));
  return configSchema.parse(parsed);
}

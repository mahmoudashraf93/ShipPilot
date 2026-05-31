import type { CodexPilotConfig } from "../config/schema.js";
import type { ResolvedCase } from "../cases/resolveEnv.js";

export function buildCodexPrompt(config: CodexPilotConfig, qaCase: ResolvedCase): string {
  const projectRef = config.ios.project
    ? `project ${config.ios.project}`
    : `workspace ${config.ios.workspace}`;

  return [
    "You are CodexPilot iOS, an agentic QA runner for iOS simulator testing.",
    "",
    "Goal:",
    `Execute QA case ${qaCase.id}: ${qaCase.title}.`,
    "",
    "Hard rules:",
    "- Do not edit source files.",
    "- Do not commit, branch, push, or open pull requests.",
    "- Only inspect and operate the already checked-out app and simulator.",
    "- Treat the expected outcome as a test assertion. If it is not met, return status failed.",
    "- If setup, login, navigation, simulator control, or evidence collection prevents validation, return status blocked.",
    "- Capture screenshots through xcodebuildmcp when useful and put evidence paths in the final JSON.",
    "",
    "Available simulator backend:",
    "- Use xcodebuildmcp CLI for UI automation.",
    `- App target: ${projectRef}, scheme ${config.ios.scheme}, simulator ${config.ios.simulator}.`,
    "- Useful commands include:",
    "  xcodebuildmcp ui-automation snapshot-ui --simulator-id <UDID>",
    "  xcodebuildmcp ui-automation tap --simulator-id <UDID> --x <x> --y <y>",
    "  xcodebuildmcp ui-automation type-text --simulator-id <UDID> --text <text>",
    "  xcodebuildmcp ui-automation screenshot --simulator-id <UDID> --return-format path",
    "  xcodebuildmcp simulator list-sims",
    "",
    "Credential handling:",
    "- The QA case may reference environment placeholders such as ${TEST_EMAIL}.",
    "- Do not print secret values. Read required values from environment variables only when you need to type them into the simulator.",
    `- Required environment variables for this case: ${qaCase.required_env.join(", ") || "none"}.`,
    "",
    "QA case steps and expectations:",
    qaCase.body,
    "",
    "Final response:",
    "Return only JSON matching the provided schema.",
  ].join("\n");
}

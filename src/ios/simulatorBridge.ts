import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Redactor } from "../security/redact.js";

export const simulatorBridgeToolNames = [
  "snapshot_ui",
  "screenshot",
  "tap",
  "type_text",
  "type_env",
  "swipe",
  "button",
  "stop_app",
  "launch_app",
] as const;

export type SimulatorBridgeToolName = (typeof simulatorBridgeToolNames)[number];

export type SimulatorBridgeContext = {
  xcodeBuildMcp: string;
  simulatorId: string;
  bundleId: string;
  cwd: string;
  envValues: Record<string, string>;
  redactor: Redactor;
  verbose: boolean;
};

export type SimulatorBridge = {
  url: string;
  close: () => Promise<void>;
};

type ProcessResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type BridgeCommand = {
  args: string[];
  successText?: string;
};

const buttonTypes = ["apple-pay", "home", "lock", "side-button", "siri"] as const;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requireFiniteNumber(value: unknown, name: string): number {
  if (!isFiniteNumber(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

function optionalFiniteNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return requireFiniteNumber(value, name);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function requireString(value: unknown, name: string): string {
  const parsed = optionalString(value, name);
  if (parsed === undefined) throw new Error(`${name} is required.`);
  return parsed;
}

function withOptionalDelayArgs(args: string[], values: Record<string, unknown>): string[] {
  const preDelay = optionalFiniteNumber(values.preDelay, "preDelay");
  const postDelay = optionalFiniteNumber(values.postDelay, "postDelay");
  if (preDelay !== undefined) args.push("--pre-delay", String(preDelay));
  if (postDelay !== undefined) args.push("--post-delay", String(postDelay));
  return args;
}

export function buildSimulatorBridgeCommand(
  toolName: SimulatorBridgeToolName,
  input: Record<string, unknown>,
  context: Pick<SimulatorBridgeContext, "simulatorId" | "bundleId" | "envValues">,
): BridgeCommand {
  switch (toolName) {
    case "snapshot_ui":
      return {
        args: ["simulator", "snapshot-ui", "--simulator-id", context.simulatorId],
      };

    case "screenshot":
      return {
        args: ["simulator", "screenshot", "--simulator-id", context.simulatorId, "--return-format", "path"],
      };

    case "tap": {
      const label = optionalString(input.label, "label");
      const id = optionalString(input.id, "id");
      const hasCoordinates = input.x !== undefined || input.y !== undefined;
      const selectorCount = Number(Boolean(label)) + Number(Boolean(id)) + Number(hasCoordinates);
      if (selectorCount !== 1) throw new Error("tap requires exactly one selector: label, id, or x/y.");

      const args = ["ui-automation", "tap", "--simulator-id", context.simulatorId];
      if (label) args.push("--label", label);
      if (id) args.push("--id", id);
      if (hasCoordinates) {
        args.push("-x", String(requireFiniteNumber(input.x, "x")));
        args.push("-y", String(requireFiniteNumber(input.y, "y")));
      }
      return { args: withOptionalDelayArgs(args, input) };
    }

    case "type_text": {
      const text = requireString(input.text, "text");
      return {
        args: ["ui-automation", "type-text", "--simulator-id", context.simulatorId, "--text", text],
        successText: "Typed text into the simulator.",
      };
    }

    case "type_env": {
      const name = requireString(input.name, "name");
      if (!Object.prototype.hasOwnProperty.call(context.envValues, name)) {
        throw new Error(`Environment variable ${name} is not declared in this QA case.`);
      }
      return {
        args: ["ui-automation", "type-text", "--simulator-id", context.simulatorId, "--text", context.envValues[name]],
        successText: `Typed environment value ${name} into the simulator.`,
      };
    }

    case "swipe": {
      const args = [
        "ui-automation",
        "swipe",
        "--simulator-id",
        context.simulatorId,
        "--x1",
        String(requireFiniteNumber(input.x1, "x1")),
        "--y1",
        String(requireFiniteNumber(input.y1, "y1")),
        "--x2",
        String(requireFiniteNumber(input.x2, "x2")),
        "--y2",
        String(requireFiniteNumber(input.y2, "y2")),
      ];
      const duration = optionalFiniteNumber(input.duration, "duration");
      const delta = optionalFiniteNumber(input.delta, "delta");
      if (duration !== undefined) args.push("--duration", String(duration));
      if (delta !== undefined) args.push("--delta", String(delta));
      return { args: withOptionalDelayArgs(args, input) };
    }

    case "button": {
      const buttonType = requireString(input.buttonType, "buttonType");
      if (!(buttonTypes as readonly string[]).includes(buttonType)) {
        throw new Error(`buttonType must be one of: ${buttonTypes.join(", ")}.`);
      }
      const args = ["ui-automation", "button", "--simulator-id", context.simulatorId, "--button-type", buttonType];
      const duration = optionalFiniteNumber(input.duration, "duration");
      if (duration !== undefined) args.push("--duration", String(duration));
      return { args };
    }

    case "stop_app":
      return {
        args: ["simulator", "stop", "--simulator-id", context.simulatorId, "--bundle-id", context.bundleId],
      };

    case "launch_app":
      return {
        args: ["simulator", "launch-app", "--simulator-id", context.simulatorId, "--bundle-id", context.bundleId],
      };
  }
}

function runBridgeProcess(command: string, args: string[], context: SimulatorBridgeContext): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    if (context.verbose) {
      console.log(context.redactor.redact(`[shippilot:bridge] $ ${[command, ...args].join(" ")}`));
    }

    const child = spawn(command, args, {
      cwd: context.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 60 * 1000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

function combinedOutput(result: ProcessResult): string {
  return [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
}

function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text }] };
}

async function executeBridgeTool(
  toolName: SimulatorBridgeToolName,
  input: Record<string, unknown>,
  context: SimulatorBridgeContext,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const command = buildSimulatorBridgeCommand(toolName, input, context);
  const result = await runBridgeProcess(context.xcodeBuildMcp, command.args, context);
  const output = context.redactor.redact(combinedOutput(result));

  if (result.status !== 0) {
    const detail = result.timedOut ? "Timed out while running simulator bridge tool." : output || "No output.";
    throw new Error(`${toolName} failed: ${detail}`);
  }

  return textResult(command.successText ?? output);
}

function createMcpServer(context: SimulatorBridgeContext): McpServer {
  const server = new McpServer({ name: "shippilot-simulator", version: "0.0.2" });
  const anyInput = z.object({}).passthrough();

  for (const toolName of simulatorBridgeToolNames) {
    server.registerTool(
      toolName,
      {
        description: `ShipPilot allowlisted simulator tool: ${toolName}`,
        inputSchema: anyInput,
      },
      async (input) => executeBridgeTool(toolName, input, context),
    );
  }

  return server;
}

function readRequestBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").trim();
      if (!body) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message }, id: null }));
}

export async function startSimulatorBridge(context: SimulatorBridgeContext): Promise<SimulatorBridge> {
  const httpServer = createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      if (requestUrl.pathname !== "/mcp") {
        sendJsonError(res, 404, "Not found.");
        return;
      }
      if (req.method !== "POST") {
        sendJsonError(res, 405, "Method not allowed.");
        return;
      }

      const mcpServer = createMcpServer(context);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      try {
        const body = await readRequestBody(req);
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (error) {
        sendJsonError(res, 500, error instanceof Error ? error.message : String(error));
      } finally {
        await transport.close().catch(() => undefined);
        await mcpServer.close().catch(() => undefined);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    throw new Error("Simulator bridge did not bind to a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise<void>((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve()))),
  };
}

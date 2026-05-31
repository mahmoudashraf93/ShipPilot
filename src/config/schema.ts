import { z } from "zod";

export const authModes = ["api_key", "access_token", "chatgpt_hosted_experimental"] as const;
export const failModes = ["failed_or_blocked", "never"] as const;

export const configSchema = z
  .object({
    codex: z
      .object({
        engine: z.literal("sdk").default("sdk"),
        auth: z.enum(authModes).default("api_key"),
        model: z.string().default("default"),
        sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("danger-full-access"),
        fail_on: z.enum(failModes).default("failed_or_blocked"),
        verbose: z.boolean().default(false),
        allow_experimental_personal_hosted_auth: z.boolean().default(false),
      })
      .default({
        engine: "sdk",
        auth: "api_key",
        model: "default",
        sandbox: "danger-full-access",
        fail_on: "failed_or_blocked",
        verbose: false,
        allow_experimental_personal_hosted_auth: false,
      }),
    ios: z.object({
      project: z.string().optional().nullable(),
      workspace: z.string().optional().nullable(),
      scheme: z.string().min(1),
      bundle_id: z.string().optional().nullable(),
      simulator: z.string().default("iPhone 17 Pro"),
      backend: z.literal("xcodebuildmcp").default("xcodebuildmcp"),
      configuration: z.string().default("Debug"),
    }),
    reports: z
      .object({
        output_dir: z.string().default(".shippilot"),
        markdown: z.boolean().default(true),
        json: z.boolean().default(true),
        junit: z.boolean().default(true),
        screenshots: z.boolean().default(true),
        logs: z.boolean().default(true),
      })
      .default({
        output_dir: ".shippilot",
        markdown: true,
        json: true,
        junit: true,
        screenshots: true,
        logs: true,
      }),
  })
  .superRefine((value, context) => {
    const hasProject = Boolean(value.ios.project);
    const hasWorkspace = Boolean(value.ios.workspace);
    if (hasProject === hasWorkspace) {
      context.addIssue({
        code: "custom",
        message: "Configure exactly one of ios.project or ios.workspace.",
        path: ["ios"],
      });
    }

    if (
      value.codex.auth === "chatgpt_hosted_experimental" &&
      !value.codex.allow_experimental_personal_hosted_auth
    ) {
      context.addIssue({
        code: "custom",
        message:
          "chatgpt_hosted_experimental requires codex.allow_experimental_personal_hosted_auth: true.",
        path: ["codex", "allow_experimental_personal_hosted_auth"],
      });
    }
  });

export type ShipPilotConfig = z.infer<typeof configSchema>;

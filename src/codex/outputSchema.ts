import { z } from "zod";

export const codexResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked"]),
  case_id: z.string(),
  title: z.string(),
  summary: z.string(),
  executed_steps: z.array(z.string()),
  expected: z.string(),
  observed: z.string(),
  failure_reason: z.string().nullable(),
  blocked_reason: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.string()),
});

export type CodexCaseResult = z.infer<typeof codexResultSchema>;

export const codexOutputJsonSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["passed", "failed", "blocked"] },
    case_id: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    executed_steps: { type: "array", items: { type: "string" } },
    expected: { type: "string" },
    observed: { type: "string" },
    failure_reason: { type: ["string", "null"] },
    blocked_reason: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: [
    "status",
    "case_id",
    "title",
    "summary",
    "executed_steps",
    "expected",
    "observed",
    "failure_reason",
    "blocked_reason",
    "confidence",
    "evidence",
  ],
  additionalProperties: false,
} as const;

export function parseCodexResult(raw: string): CodexCaseResult {
  return codexResultSchema.parse(JSON.parse(raw));
}

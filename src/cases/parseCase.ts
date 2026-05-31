import { readFileSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const qaCaseFrontMatterSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  required_env: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string()).default([]),
});

export type QaCase = z.infer<typeof qaCaseFrontMatterSchema> & {
  body: string;
  path: string;
};

export function parseCase(casePath: string, cwd = process.cwd()): QaCase {
  const absolutePath = path.resolve(cwd, casePath);
  const parsed = matter(readFileSync(absolutePath, "utf8"));
  const frontMatter = qaCaseFrontMatterSchema.parse(parsed.data);

  return {
    ...frontMatter,
    body: parsed.content.trim(),
    path: absolutePath,
  };
}

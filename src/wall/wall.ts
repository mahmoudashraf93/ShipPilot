import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const wallSourcePath = "docs/wall-of-apps.json";
export const readmePath = "README.md";
export const wallStartMarker = "<!-- shippilot-wall:start -->";
export const wallEndMarker = "<!-- shippilot-wall:end -->";
export const upstreamOwner = "mahmoudashraf93";
export const upstreamRepo = "ShipPilot";
export const upstreamBranch = "main";

const appStoreIdPattern = /\/id(\d+)(?:[/?#]|$)/;
const numericIdPattern = /^\d+$/;
const rawBaseUrl = `https://raw.githubusercontent.com/${upstreamOwner}/${upstreamRepo}/${upstreamBranch}`;

export type WallEntry = {
  app: string;
  link: string;
  icon: string;
};

export type WallSubmitOptions = {
  app?: string;
  country?: string;
  name?: string;
  link?: string;
  icon?: string;
  dryRun?: boolean;
  confirm?: boolean;
  cwd?: string;
  now?: Date;
  gh?: GhRunner;
  fetch?: typeof fetch;
};

export type WallSubmitResult = {
  mode: "dry-run" | "confirmed";
  appId?: string;
  app: string;
  link: string;
  icon: string;
  upstreamRepo: string;
  forkRepo: string;
  branch: string;
  changedFiles: string[];
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  pullRequestUrl?: string;
  warnings: string[];
};

type AppStoreLookupResult = {
  trackName?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
};

export type GhRunner = (args: string[]) => Promise<string>;

export function decodeWallEntries(raw: string, source = wallSourcePath): WallEntry[] {
  if (raw.trim() === "") throw new Error(`Wall source ${source} is empty.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid wall source ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) throw new Error(`Wall source ${source} must be a JSON array.`);
  return canonicalizeWallEntries(
    parsed.map((item, index) => {
      if (!isRecord(item)) throw new Error(`Wall entry ${index + 1} must be an object.`);
      return {
        app: stringField(item.app, `Wall entry ${index + 1} app`),
        link: stringField(item.link, `Wall entry ${index + 1} link`),
        icon: stringField(item.icon, `Wall entry ${index + 1} icon`),
      };
    }),
  );
}

export function canonicalizeWallEntries(entries: WallEntry[]): WallEntry[] {
  const normalized = entries.map((entry) => ({
    app: entry.app.trim(),
    link: entry.link.trim(),
    icon: entry.icon.trim(),
  }));

  const seenLinks = new Set<string>();
  const seenAppIds = new Set<string>();
  for (const entry of normalized) {
    if (!entry.app) throw new Error("Wall entry app is required.");
    assertHttpUrl(entry.link, "Wall entry link");
    assertHttpUrl(entry.icon, "Wall entry icon");

    const normalizedLink = normalizeUrlForDuplicateCheck(entry.link);
    if (seenLinks.has(normalizedLink)) throw new Error(`Duplicate wall entry link: ${entry.link}`);
    seenLinks.add(normalizedLink);

    const appId = appStoreIdFromInput(entry.link);
    if (appId) {
      if (seenAppIds.has(appId)) throw new Error(`Duplicate App Store app id: ${appId}`);
      seenAppIds.add(appId);
    }
  }

  return normalized.sort((a, b) => a.app.localeCompare(b.app, "en", { sensitivity: "base" }));
}

export function renderWallJson(entries: WallEntry[]): string {
  return `${JSON.stringify(canonicalizeWallEntries(entries), null, 2)}\n`;
}

export function renderWallMarkdown(entries: WallEntry[]): string {
  const canonical = canonicalizeWallEntries(entries);
  if (canonical.length === 0) {
    return "No apps are on the wall yet. Add yours with `shippilot wall submit --app \"1234567890\" --dry-run`.";
  }

  const lines = [
    "<table>",
    "  <tr>",
    ...canonical.map(
      (entry) =>
        `    <td align="center" width="120"><a href="${escapeHtml(entry.link)}"><img src="${escapeHtml(
          entry.icon,
        )}" alt="${escapeHtml(entry.app)} icon" width="64" height="64"><br>${escapeHtml(entry.app)}</a></td>`,
    ),
    "  </tr>",
    "</table>",
  ];
  return lines.join("\n");
}

export function updateReadmeWallSection(readme: string, entries: WallEntry[]): string {
  const start = readme.indexOf(wallStartMarker);
  const end = readme.indexOf(wallEndMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README must contain ${wallStartMarker} and ${wallEndMarker} markers.`);
  }

  const before = readme.slice(0, start + wallStartMarker.length);
  const after = readme.slice(end);
  return `${before}\n${renderWallMarkdown(entries)}\n${after}`;
}

export function renderWallOutput(entries: WallEntry[], output: "table" | "json" | "markdown"): string {
  const canonical = canonicalizeWallEntries(entries);
  if (output === "json") return JSON.stringify({ data: canonical }, null, 2);
  if (output === "markdown") return renderWallMarkdown(canonical);

  const rows = [["App", "Link"], ...canonical.map((entry) => [entry.app, entry.link])];
  const appWidth = Math.max(...rows.map((row) => row[0].length));
  const linkWidth = Math.max(...rows.map((row) => row[1].length));
  return rows.map(([app, link]) => `${app.padEnd(appWidth)}  ${link.padEnd(linkWidth)}`).join("\n");
}

export function applyWallLimitAndSort(entries: WallEntry[], sort: string, limit: number): WallEntry[] {
  if (sort !== "name" && sort !== "-name") throw new Error("--sort must be name or -name.");
  if (limit !== 0 && (limit < 1 || limit > 200)) throw new Error("--limit must be between 1 and 200.");

  const sorted = canonicalizeWallEntries(entries);
  if (sort === "-name") sorted.reverse();
  return limit > 0 ? sorted.slice(0, limit) : sorted;
}

export async function loadWallEntries(options: { source?: string; cwd?: string; fetch?: typeof fetch } = {}): Promise<WallEntry[]> {
  const source = options.source?.trim();
  if (source) {
    return decodeWallEntries(await readSourceText(source, options.fetch), source);
  }

  const cwd = options.cwd ?? process.cwd();
  const localPath = path.resolve(cwd, wallSourcePath);
  try {
    return decodeWallEntries(readFileSync(localPath, "utf8"), localPath);
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  return decodeWallEntries(await readSourceText(`${rawBaseUrl}/${wallSourcePath}`, options.fetch), `${rawBaseUrl}/${wallSourcePath}`);
}

export async function resolveWallEntry(options: WallSubmitOptions): Promise<{ entry: WallEntry; appId?: string }> {
  if (options.app) {
    const appId = appStoreIdFromInput(options.app);
    if (!appId) throw new Error("--app must be a numeric App Store id or an App Store URL containing /id123.");
    const resolved = await lookupAppStoreApp(appId, options.country ?? "us", options.fetch);
    return {
      appId,
      entry: {
        app: options.name?.trim() || resolved.app,
        link: options.link?.trim() || resolved.link,
        icon: options.icon?.trim() || resolved.icon,
      },
    };
  }

  if (!options.name || !options.link || !options.icon) {
    throw new Error("Manual wall submissions require --name, --link, and --icon.");
  }

  return {
    entry: {
      app: options.name,
      link: options.link,
      icon: options.icon,
    },
  };
}

export async function lookupAppStoreApp(appId: string, country: string, fetchImpl: typeof fetch = fetch): Promise<WallEntry> {
  const url = new URL("https://itunes.apple.com/lookup");
  url.searchParams.set("id", appId);
  url.searchParams.set("country", country);

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`App Store lookup failed with status ${response.status}.`);

  const payload = (await response.json()) as { resultCount?: number; results?: AppStoreLookupResult[] };
  const result = payload.results?.[0];
  if (!result || payload.resultCount === 0) throw new Error(`No public App Store app found for id ${appId}.`);

  const app = result.trackName?.trim();
  const link = result.trackViewUrl?.trim();
  const icon = result.artworkUrl512?.trim() || result.artworkUrl100?.trim();
  if (!app || !link || !icon) throw new Error(`App Store lookup for id ${appId} did not include name, link, and icon.`);

  return { app, link, icon };
}

export async function submitWallEntry(options: WallSubmitOptions): Promise<WallSubmitResult> {
  if (options.confirm && options.dryRun) throw new Error("Use either --dry-run or --confirm, not both.");
  if (!options.confirm && !options.dryRun) throw new Error("--confirm is required unless --dry-run is set.");

  const { entry, appId } = await resolveWallEntry(options);
  const fetchImpl = options.fetch ?? fetch;
  const cwd = options.cwd ?? process.cwd();
  const preferLocal = options.dryRun === true;
  const baseEntries = decodeWallEntries(await readProjectBaseText(wallSourcePath, cwd, fetchImpl, preferLocal), wallSourcePath);
  const readme = await readProjectBaseText(readmePath, cwd, fetchImpl, preferLocal);
  const nextEntries = canonicalizeWallEntries([...baseEntries, entry]);
  const nextWallJson = renderWallJson(nextEntries);
  const nextReadme = updateReadmeWallSection(readme, nextEntries);
  const branch = buildWallBranch(appId ?? entry.app, options.now ?? new Date());
  const commitMessage = `Add ${entry.app} to Wall of Apps`;
  const pullRequestTitle = commitMessage;
  const pullRequestBody = [
    "Adds an app to the ShipPilot Wall of Apps.",
    "",
    `App: ${entry.app}`,
    `Link: ${entry.link}`,
  ].join("\n");

  const dryResult: WallSubmitResult = {
    mode: options.dryRun ? "dry-run" : "confirmed",
    appId,
    app: entry.app,
    link: entry.link,
    icon: entry.icon,
    upstreamRepo: `${upstreamOwner}/${upstreamRepo}`,
    forkRepo: "<your-github-login>/ShipPilot",
    branch,
    changedFiles: [wallSourcePath, readmePath],
    commitMessage,
    pullRequestTitle,
    pullRequestBody,
    warnings: [],
  };

  if (options.dryRun) return dryResult;

  const gh = options.gh ?? defaultGhRunner;
  const login = (await gh(["api", "user", "--jq", ".login"])).trim();
  if (!login) throw new Error("Could not resolve GitHub login from gh.");

  const forkRepo = `${login}/${upstreamRepo}`;
  await ensureFork(login, gh);
  await createBranchOnFork(login, branch, gh);
  await putFileOnFork(login, branch, wallSourcePath, nextWallJson, commitMessage, gh);
  await putFileOnFork(login, branch, readmePath, nextReadme, commitMessage, gh);

  const pullRequestUrl = (
    await gh([
      "pr",
      "create",
      "--repo",
      `${upstreamOwner}/${upstreamRepo}`,
      "--head",
      `${login}:${branch}`,
      "--base",
      upstreamBranch,
      "--title",
      pullRequestTitle,
      "--body",
      pullRequestBody,
    ])
  ).trim();

  return {
    ...dryResult,
    forkRepo,
    pullRequestUrl,
  };
}

function buildWallBranch(app: string, now: Date): string {
  const slug = app
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z");
  return `wall/add-${slug || "app"}-${stamp}`;
}

async function ensureFork(login: string, gh: GhRunner): Promise<void> {
  try {
    await gh(["repo", "view", `${login}/${upstreamRepo}`, "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  } catch {
    await gh(["api", "-X", "POST", `repos/${upstreamOwner}/${upstreamRepo}/forks`]);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await gh(["repo", "view", `${login}/${upstreamRepo}`, "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
        return;
      } catch {
        await sleep(1000);
      }
    }
    throw new Error(`Fork ${login}/${upstreamRepo} was requested but is not ready yet. Try again in a moment.`);
  }
}

async function createBranchOnFork(login: string, branch: string, gh: GhRunner): Promise<void> {
  const baseSha = (await gh(["api", `repos/${upstreamOwner}/${upstreamRepo}/git/ref/heads/${upstreamBranch}`, "--jq", ".object.sha"])).trim();
  await gh(["api", "-X", "POST", `repos/${login}/${upstreamRepo}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${baseSha}`]);
}

async function putFileOnFork(login: string, branch: string, filePath: string, content: string, message: string, gh: GhRunner): Promise<void> {
  const sha = (
    await gh(["api", `repos/${upstreamOwner}/${upstreamRepo}/contents/${filePath}`, "-f", `ref=${upstreamBranch}`, "--jq", ".sha"])
  ).trim();
  await gh([
    "api",
    "-X",
    "PUT",
    `repos/${login}/${upstreamRepo}/contents/${filePath}`,
    "-f",
    `message=${message}`,
    "-f",
    `content=${Buffer.from(content, "utf8").toString("base64")}`,
    "-f",
    `branch=${branch}`,
    "-f",
    `sha=${sha}`,
  ]);
}

async function defaultGhRunner(args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("gh", args, { maxBuffer: 10 * 1024 * 1024 });
    return result.stdout;
  } catch (error) {
    if (isExecError(error)) {
      const detail = [error.stderr, error.stdout].filter(Boolean).join("\n").trim();
      throw new Error(`gh ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`);
    }
    throw error;
  }
}

async function readSourceText(source: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const response = await fetchImpl(source);
    if (!response.ok) throw new Error(`Failed to fetch ${source}: ${response.status} ${response.statusText}`);
    return response.text();
  }
  return readFileSync(source, "utf8");
}

async function readProjectBaseText(filePath: string, cwd: string, fetchImpl: typeof fetch, preferLocal: boolean): Promise<string> {
  const localPath = path.resolve(cwd, filePath);
  if (preferLocal) {
    try {
      return readFileSync(localPath, "utf8");
    } catch {
      // Fall through to the upstream source when the command is run outside the repo.
    }
  }

  try {
    return await readSourceText(`${rawBaseUrl}/${filePath}`, fetchImpl);
  } catch (error) {
    try {
      return readFileSync(localPath, "utf8");
    } catch {
      throw error;
    }
  }
}

function appStoreIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (numericIdPattern.test(trimmed)) return trimmed;
  return appStoreIdPattern.exec(trimmed)?.[1] ?? null;
}

function normalizeUrlForDuplicateCheck(input: string): string {
  const parsed = new URL(input);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

function assertHttpUrl(value: string, label: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
  } catch {
    throw new Error(`${label} must be an http(s) URL.`);
  }
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required.`);
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isExecError(error: unknown): error is { stdout?: string; stderr?: string } {
  return isRecord(error) && ("stdout" in error || "stderr" in error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shared helpers for the registry scripts. Node 20+, no dependencies.
import { readFileSync, writeFileSync } from "node:fs";

export const MARKETPLACE_NAME = "mkbuilds";
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const ENTRY_KEYS = ["id", "name", "author", "description", "repo", "path"];
export const REQUIRED_KEYS = ["id", "name", "author", "description", "repo"];
export const MAX_DESCRIPTION = 250;

export function readJSON(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJSON(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

/** GET a GitHub REST path. Returns null on 404; throws on anything else. */
export async function github(path, { raw = false } = {}) {
  const headers = {
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mkbuilds-mods-registry",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://api.github.com/${path}`, { headers });
    if (response.status === 404) return null;
    if (response.ok) return raw ? response.text() : response.json();
    if (attempt < 3 && response.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }
    throw new Error(`GitHub ${response.status} for ${path}: ${(await response.text()).slice(0, 200)}`);
  }
}

const join = (...parts) => parts.filter(Boolean).join("/");

/**
 * The release a mod ships from: the newest published (non-draft, non-prerelease) release.
 * In a repo with several mods, tag releases `<id>-<version>`; the newest such tag wins.
 */
export async function pickRelease(entry) {
  const releases = (await github(`repos/${entry.repo}/releases?per_page=100`)) ?? [];
  const published = releases.filter((r) => !r.draft && !r.prerelease);
  return published.find((r) => r.tag_name.startsWith(`${entry.id}-`)) ?? published[0] ?? null;
}

/** Everything the registry needs to know about one entry, read at its release. */
export async function resolveEntry(entry) {
  const repo = await github(`repos/${entry.repo}`);
  if (!repo) throw new Error(`repo ${entry.repo} not found or private`);
  const release = await pickRelease(entry);
  if (!release) throw new Error(`${entry.repo} has no published GitHub release`);
  const tag = release.tag_name;
  const commit = await github(`repos/${entry.repo}/commits/${encodeURIComponent(tag)}`);
  if (!commit) throw new Error(`tag ${tag} not found`);
  const manifestPath = join(entry.path, ".claude-plugin/plugin.json");
  const manifestText = await github(
    `repos/${entry.repo}/contents/${manifestPath}?ref=${commit.sha}`, { raw: true });
  if (manifestText == null) throw new Error(`no ${manifestPath} at ${tag}`);
  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    throw new Error(`${manifestPath} at ${tag} is not valid JSON`);
  }
  return { repo, release, tag, sha: commit.sha, manifest };
}

/** The marketplace.json entry for a resolved mod, pinned to its release commit. */
export function marketplaceEntry(entry, resolved) {
  const { tag, sha, manifest } = resolved;
  const url = `https://github.com/${entry.repo}`;
  const source = entry.path
    ? { source: "git-subdir", url: `${url}.git`, path: entry.path, ref: tag, sha }
    : { source: "github", repo: entry.repo, ref: tag, sha };
  const plugin = {
    name: entry.id,
    source,
    description: entry.description,
    version: manifest.version,
    author: { name: entry.author },
    homepage: entry.path ? `${url}/tree/${tag}/${entry.path}` : url,
  };
  if (manifest.category) plugin.category = manifest.category;
  if (Array.isArray(manifest.keywords)) plugin.keywords = manifest.keywords;
  return plugin;
}

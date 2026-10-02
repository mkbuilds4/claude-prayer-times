// Regenerates .claude-plugin/marketplace.json and community-mod-stats.json from
// community-mods.json. Each mod is pinned to the commit of its latest GitHub release, so only
// released code ever ships, never a branch. Run by .github/workflows/build.yml; never edit
// marketplace.json by hand.
//
//   GITHUB_TOKEN=… node scripts/build-marketplace.mjs
import {
  MARKETPLACE_NAME, marketplaceEntry, readJSON, resolveEntry, writeJSON,
} from "./lib.mjs";

const MARKETPLACE = ".claude-plugin/marketplace.json";
const STATS = "community-mod-stats.json";

const entries = readJSON("community-mods.json");
const removed = new Set(readJSON("community-mods-removed.json", []).map((r) => r.id));
const previous = readJSON(MARKETPLACE, { plugins: [] });
const previousByName = new Map(previous.plugins.map((p) => [p.name, p]));
const previousStats = readJSON(STATS, {});

const plugins = [];
const stats = {};
let failures = 0;

for (const entry of entries) {
  if (removed.has(entry.id)) continue;
  try {
    const resolved = await resolveEntry(entry);
    plugins.push(marketplaceEntry(entry, resolved));
    stats[entry.id] = {
      stars: resolved.repo.stargazers_count,
      release: resolved.tag,
      updated: resolved.release.published_at,
    };
    console.log(`ok   ${entry.id} ${resolved.manifest.version} @ ${resolved.tag}`);
  } catch (error) {
    failures++;
    // A transient failure shouldn't drop a mod: keep what was published last time.
    const kept = previousByName.get(entry.id);
    if (kept) {
      plugins.push(kept);
      if (previousStats[entry.id]) stats[entry.id] = previousStats[entry.id];
    }
    console.warn(`skip ${entry.id}: ${error.message}${kept ? " (kept previous entry)" : ""}`);
  }
}

writeJSON(MARKETPLACE, {
  $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
  name: MARKETPLACE_NAME,
  owner: { name: "MK Builds", url: "https://mkbuilds.dev" },
  description: "Claude Code mods for NotchNerd and beyond, by MK Builds and the community. Generated from community-mods.json.",
  plugins,
});
writeJSON(STATS, stats);
console.log(`${plugins.length} mods published, ${failures} problem(s).`);

// Checks a pull request against community-mods.json, like Obsidian's review bot: the list is
// well-formed, and every added or changed mod has a public repo, a published release, and a
// valid plugin manifest at that release. Writes a Markdown report and exits 1 on any error.
//
//   node scripts/validate-submission.mjs <base.json> <head.json> <report.md> [pr-author] [changed-files…]
//
// Reads the submitted list as data only; it never runs the submitted mod's code.
import { writeFileSync } from "node:fs";
import {
  ENTRY_KEYS, ID_PATTERN, MAX_DESCRIPTION, REQUIRED_KEYS, github, readJSON, resolveEntry,
} from "./lib.mjs";

const [basePath, headPath, reportPath, prAuthor = "", ...changedFiles] = process.argv.slice(2);
const errors = [];
const warnings = [];
const passed = [];

const report = () => {
  const lines = ["## Mod submission check", ""];
  if (errors.length === 0) lines.push("✅ All automatic checks passed. A maintainer will review the mod next.", "");
  else lines.push("❌ Please fix the problems below, then push to this branch to re-run the check.", "");
  for (const e of errors) lines.push(`- ❌ ${e}`);
  for (const w of warnings) lines.push(`- ⚠️ ${w}`);
  for (const p of passed) lines.push(`- ✅ ${p}`);
  lines.push("", "<sub>See [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md) for the requirements.</sub>");
  writeFileSync(reportPath, lines.join("\n") + "\n");
  process.exit(errors.length ? 1 : 0);
};

let base, head;
try {
  base = readJSON(basePath);
} catch {
  base = [];
}
try {
  head = readJSON(headPath);
} catch (error) {
  errors.push(`\`community-mods.json\` is not valid JSON: ${error.message}`);
  report();
}
if (!Array.isArray(head)) {
  errors.push("`community-mods.json` must be a JSON array.");
  report();
}

const otherFiles = changedFiles.filter((f) => f !== "community-mods.json");
if (otherFiles.length) {
  warnings.push(`This PR also changes ${otherFiles.map((f) => `\`${f}\``).join(", ")}. Submissions should only add an entry to \`community-mods.json\`; a maintainer will look at the rest.`);
}

// Shape of every entry, and uniqueness across the whole list.
const seenIDs = new Set();
const seenSources = new Set();
head.forEach((entry, index) => {
  const where = `Entry ${index + 1}${entry?.id ? ` (\`${entry.id}\`)` : ""}`;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    errors.push(`${where} is not an object.`);
    return;
  }
  for (const key of REQUIRED_KEYS) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) errors.push(`${where} is missing \`${key}\`.`);
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.includes(key)) errors.push(`${where} has an unknown field \`${key}\`. Allowed: ${ENTRY_KEYS.join(", ")}.`);
  }
  if (entry.path !== undefined && (typeof entry.path !== "string" || entry.path.startsWith("/") || entry.path.includes(".."))) {
    errors.push(`${where}: \`path\` must be a relative folder inside the repo.`);
  }
  if (typeof entry.id === "string") {
    if (!ID_PATTERN.test(entry.id) || entry.id.length > 50) errors.push(`${where}: \`id\` must be lowercase words joined by hyphens (e.g. \`focus-timer\`), at most 50 characters.`);
    if (seenIDs.has(entry.id)) errors.push(`${where}: the id \`${entry.id}\` is already taken.`);
    seenIDs.add(entry.id);
  }
  if (typeof entry.repo === "string") {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(entry.repo)) errors.push(`${where}: \`repo\` must look like \`owner/name\`.`);
    const source = `${entry.repo.toLowerCase()}/${entry.path ?? ""}`;
    if (seenSources.has(source)) errors.push(`${where}: this repo${entry.path ? " folder" : ""} is already listed.`);
    seenSources.add(source);
  }
  if (typeof entry.description === "string" && entry.description.length > MAX_DESCRIPTION) {
    errors.push(`${where}: \`description\` is ${entry.description.length} characters; keep it under ${MAX_DESCRIPTION}.`);
  }
});

const baseByID = new Map(base.map((e) => [e.id, e]));
const headIDs = new Set(head.map((e) => e?.id));
const deleted = base.filter((e) => !headIDs.has(e.id));
if (deleted.length) {
  warnings.push(`Removes ${deleted.map((e) => `\`${e.id}\``).join(", ")}. Removals need a maintainer and an entry in \`community-mods-removed.json\`.`);
}
const touched = head.filter((e) => e && JSON.stringify(baseByID.get(e.id)) !== JSON.stringify(e));
if (touched.length === 0 && deleted.length === 0) {
  warnings.push("No entries were added or changed.");
}

// New entries go at the end, like Obsidian's list, which keeps diffs and merges simple.
const added = touched.filter((e) => !baseByID.has(e.id));
if (added.length && head.slice(-added.length).some((e) => baseByID.has(e.id))) {
  errors.push("Add new mods at the end of the list.");
}

const removedIDs = new Set(readJSON("community-mods-removed.json", []).map((r) => r.id));

for (const entry of touched) {
  if (typeof entry.id !== "string" || typeof entry.repo !== "string") continue;
  const label = `\`${entry.id}\``;
  if (removedIDs.has(entry.id)) {
    errors.push(`${label} was removed from the directory; pick a new id or ask a maintainer.`);
    continue;
  }
  const owner = entry.repo.split("/")[0].toLowerCase();
  if (baseByID.has(entry.id) && prAuthor && prAuthor.toLowerCase() !== owner) {
    warnings.push(`${label} already exists and @${prAuthor} doesn't own \`${entry.repo}\`; a maintainer must approve changes to someone else's listing.`);
  }

  try {
    const resolved = await resolveEntry(entry);
    const { repo, tag, manifest, sha } = resolved;
    if (repo.private) errors.push(`${label}: \`${entry.repo}\` must be public.`);
    if (repo.archived) errors.push(`${label}: \`${entry.repo}\` is archived.`);
    if (manifest.name !== entry.id) errors.push(`${label}: \`plugin.json\` at \`${tag}\` has \`"name": ${JSON.stringify(manifest.name)}\`; it must equal the id.`);
    if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+/.test(manifest.version)) errors.push(`${label}: \`plugin.json\` needs a \`version\` like \`1.0.0\`.`);
    if (typeof manifest.description !== "string" || !manifest.description.trim()) errors.push(`${label}: \`plugin.json\` needs a \`description\`.`);

    const dir = entry.path ? `${entry.path}/` : "";
    const listing = (await github(`repos/${entry.repo}/contents/${entry.path ?? ""}?ref=${sha}`)) ?? [];
    const names = Array.isArray(listing) ? listing.map((f) => f.name.toLowerCase()) : [];
    if (!names.includes("readme.md")) errors.push(`${label}: add a \`${dir}README.md\` that explains what the mod does.`);
    const rootListing = entry.path ? ((await github(`repos/${entry.repo}/contents?ref=${sha}`)) ?? []) : listing;
    const hasLicense = [...names, ...rootListing.map((f) => f.name.toLowerCase())].some((n) => n.startsWith("license") || n === "copying");
    if (!hasLicense) errors.push(`${label}: add a LICENSE file.`);

    if (!errors.some((e) => e.startsWith(label))) {
      passed.push(`${label} ${manifest.version}: public repo, release \`${tag}\`, valid manifest, README and license.`);
    }
  } catch (error) {
    errors.push(`${label}: ${error.message}.`);
  }
}

report();

# Submitting a mod

Anyone can list a Claude Code mod here. Your code stays in **your own GitHub repo**; this repo only holds the list. NotchNerd's Settings → Mods tab and `claude plugin install <id>@mkbuilds` both install from it.

## 1. Get your mod ready

Your repo (or a folder in it) is a Claude Code plugin:

```
your-repo/
├── .claude-plugin/plugin.json   # "name" must equal your id; needs "version" and "description"
├── hooks/ …                     # whatever your mod is made of
├── README.md                    # what it does, how to set it up, what it touches
└── LICENSE
```

Check it locally:

```bash
claude plugin validate .
claude --plugin-dir .            # try it in a real session
```

## 2. Publish a GitHub release

Users only ever get **released** code, never your main branch. Create a GitHub release (not a draft or pre-release) with your version as the tag, e.g. `1.0.0`. The registry pins your mod to that release's commit.

If one repo holds several mods, tag each mod's releases `<id>-<version>` (e.g. `focus-timer-1.2.0`). The newest tag with your id's prefix wins.

## 3. Open a pull request

Add your entry to the **end** of [`community-mods.json`](community-mods.json):

```json
{
  "id": "focus-timer",
  "name": "Focus Timer",
  "author": "Your Name",
  "description": "A pomodoro timer in Claude Code's footer that pauses while Claude is working.",
  "repo": "you/claude-focus-timer"
}
```

| Field | Rules |
| --- | --- |
| `id` | Lowercase words joined by hyphens, unique, at most 50 characters. Same as `name` in your `plugin.json`. Becomes the install id `focus-timer@mkbuilds`. |
| `name` | Display name. |
| `author` | You or your team. |
| `description` | One or two sentences, under 250 characters. Say what it does, not that it's a plugin. |
| `repo` | `owner/repo` on GitHub. Must be public. |
| `path` | Optional. The folder holding `.claude-plugin/plugin.json`, if it isn't the repo root. |

Only change `community-mods.json` in a submission PR.

## 4. Review

A bot checks your PR within a minute and comments: the entry's shape, a public repo, a published release, a valid `plugin.json` whose name matches the id, a README and a license. Fix anything it flags by pushing to your branch; it re-runs on its own.

A maintainer then reads your mod's code before merging. Things that get a mod declined:

- Code that's obfuscated or minified with no readable source.
- Network requests, telemetry or remote code that the README doesn't disclose.
- Reading or sending credentials, tokens, or files outside what the mod needs.
- Ads, or anything that sends prompts or turns as the user without them asking.
- Copying someone else's mod without credit or against its license.

Once merged, your mod appears in NotchNerd and the marketplace within a few minutes.

## Updates

Publish a new GitHub release. The marketplace is rebuilt nightly and picks up the newest release on its own; there's no need to open another PR. Open one only to change your listing (name, description, repo).

## Removal

Mods that break, go unmaintained, or break these rules can be removed. Removed mods go in [`community-mods-removed.json`](community-mods-removed.json) with a reason, so NotchNerd can warn anyone who still has one installed. To remove your own mod, open a PR or an issue.

# MK Builds mods

An open directory of Claude Code mods, run by [MK Builds](https://mkbuilds.dev) and open to community submissions. Mods run inside Claude Code, in the terminal or the desktop app's Code tab, and [NotchNerd](https://github.com/7amza-eth/NotchNerd) can install them from its Settings.

| Mod | What it does |
| --- | --- |
| [`prayer-times`](plugins/prayer-times) | The next prayer under the prompt, a gentle reminder at adhan, and a `/prayer` pane with today's sky, the timetable, a prayer tracker and the Qibla. Calculated on your machine. |
| [`notchnerd`](https://github.com/7amza-eth/NotchNerd/tree/main/tooling/claude-code-mod) | For [NotchNerd](https://github.com/7amza-eth/NotchNerd) users: lets Claude read and add to the notch notepad, adds `/notch`, and lets you reply to sessions from the notch. |

<p align="center"><img src="docs/pane.png" alt="The /prayer pane: today's sky with the sun on its path, the day's timetable, the week's rings, and the Qibla" width="420"></p>

## Install

```bash
claude plugin marketplace add mkbuilds4/mods
claude plugin install prayer-times@mkbuilds
claude plugin install notchnerd@mkbuilds
```

Start a new chat and the mod loads. If you use NotchNerd, you can also install and remove these from **Settings → Mods**.

Installed from the old `mkbuilds4/claude-prayer-times` name? Nothing to do: GitHub forwards it here, and `claude plugin marketplace update mkbuilds` picks up new mods.

## Submit your own

The directory is open to everyone, the way Obsidian's plugin directory is: your code stays in your repo, and you open a PR that adds one entry to [`community-mods.json`](community-mods.json). A bot checks it, a maintainer reviews it, and once it's merged your mod shows up in NotchNerd's Settings → Mods and in `claude plugin install`. Full steps are in [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

| File | What it is |
| --- | --- |
| [`community-mods.json`](community-mods.json) | The list. The only file a submission changes. |
| [`community-mods-removed.json`](community-mods-removed.json) | Mods taken out of the directory, with the reason. NotchNerd warns anyone who still has one. |
| [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) | **Generated**; don't edit it. The Claude Code marketplace built from the list, with each mod pinned to its latest GitHub release. |
| [`community-mod-stats.json`](community-mod-stats.json) | Generated: stars and latest release for each mod. |

[`build.yml`](.github/workflows/build.yml) regenerates the marketplace when the list changes and every night, so new releases reach users without a PR. [`validate.yml`](.github/workflows/validate.yml) checks submissions.

## License

Each mod carries its own license, in its own repo. This repo's scripts and [`prayer-times`](plugins/prayer-times#license) are MIT (with an LGPL calculation file); `notchnerd` is GPL v3 like the NotchNerd app.

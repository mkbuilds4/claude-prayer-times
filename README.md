# MK Builds mods

A Claude Code marketplace of mods by [MK Builds](https://mkbuilds.dev). Mods run inside Claude Code, in the terminal or the desktop app's Code tab.

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

## Adding a mod

A mod can live in this repo under `plugins/<name>` or in its own repo. Add an entry to [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json) (use a `git-subdir` source when the plugin sits in a subfolder of another repo), bump its `version` when you release, and check the catalog with:

```bash
claude plugin validate .
```

## License

Each mod carries its own license: [`prayer-times`](plugins/prayer-times#license) is MIT with an LGPL calculation file, and `notchnerd` is GPL v3 like the NotchNerd app.

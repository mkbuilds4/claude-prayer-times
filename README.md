# Prayer times for Claude Code

A small Claude Code mod that keeps the next prayer in view while you work.

- **Status line:** the next prayer, always. `Asr 4:18 PM`, or `Asr in 18 min` within the hour.
- **Above the prompt:** a quiet reminder from 15 minutes before adhan, then `Asr now` for 20 minutes after, with a Done button. On Fridays Dhuhr is shown as Jumu'ah.
- **At adhan:** a notice and a soft chime (or a spoken reminder, or nothing). With several chats open, only one plays it.
- **`/prayer`:** today's Fajr, Sunrise, Dhuhr, Asr, Maghrib and Isha, tomorrow's Fajr, and the Hijri date.

Everything is calculated on your machine. It makes no network requests and sends nothing anywhere.

## Install

You need a Claude Code version with mods (function hooks), in the terminal or the desktop app's Code tab.

```bash
claude plugin marketplace add mkbuilds4/claude-prayer-times
claude plugin install prayer-times@mkbuilds
```

Start a new chat and the next prayer appears in the status line.

## Set your location

Out of the box it guesses from your time zone: New York for US Eastern, London for UK time, Cairo for Egypt, and so on, with the method most used there. For accurate times, set your own coordinates (find them by right-clicking your city in Google Maps):

```bash
echo '{"latitude":"40.71","longitude":"-74.01","place":"New York"}' | claude plugin configure prayer-times@mkbuilds --values-stdin
```

Or change them in `/config` inside Claude Code. All the settings:

| Setting | What it does | Default |
|---|---|---|
| `latitude`, `longitude` | Where to calculate for | guessed from your time zone |
| `place` | The name shown in `/prayer` | the guessed city |
| `method` | `ISNA`, `MWL` (Muslim World League), `Egyptian`, `UmmAlQura`, `Karachi`, or `auto` | `auto` (by region) |
| `asr` | `Standard` (Shafi'i, Maliki, Hanbali) or `Hanafi` | `Standard` |
| `sound` | `chime`, `voice`, or `off` | `chime` |

## How it calculates

It uses the standard astronomical method from [PrayTimes.org](http://praytimes.org):
- **Dhuhr:** solar noon, from the sun's declination and the equation of time.
- **Fajr and Isha:** when the sun sits the method's angle below the horizon.
- **Sunrise and Maghrib:** the sun at 0.833° below the horizon, to allow for refraction.
- **Asr:** when a shadow reaches the object's length (twice that for Hanafi), plus its noon shadow.

Daylight saving comes from your computer's clock for each date.

Checked against [aladhan.com](https://aladhan.com) for the same location and method across a winter, a summer and an autumn day: 16 of 18 times matched to the minute, and the other two were one minute apart. That's about how much masjid timetables differ from each other anyway. If your masjid publishes its own timetable, follow it. Iqamah times are your masjid's, not astronomy's, so the mod doesn't try to show them.

## Files

- `plugins/prayer-times/hooks/times.ts`: the calculation, with no Claude Code dependencies.
- `plugins/prayer-times/hooks/chime.ts`: the chime, synthesized as a WAV in code (no sound files).
- `plugins/prayer-times/hooks/register.tsx`: the status line, reminder, pane and adhan notice.

MIT licensed. Made by [MK Builds](https://mkbuilds.dev).

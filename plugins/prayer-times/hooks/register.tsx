import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { PrayerTimesPrefs as Prefs } from '../types'
import { compass, hero, icon, week } from './art'
import { chimeWav, toBase64 } from './chime'
import {
  clock,
  compassPoint,
  currentPrayer,
  guessFromZone,
  label,
  METHOD_NAMES,
  nextPrayer,
  ORDER,
  parseLocation,
  PRAYERS,
  prayerTimes,
  qibla,
  type AsrMethod,
  type Method,
  type PrayerName,
  type Settings,
} from './times'

const PANE = 'prayer-times'
// The reminder row shows from this long before adhan until this long after it.
const BEFORE_MS = 15 * 60 * 1000
const AFTER_MS = 20 * 60 * 1000
// A prayer that began less than this long ago is announced (once, across chats).
const ANNOUNCE_WINDOW_MS = 3 * 60 * 1000
// How far the pane's day arrows go either way.
const MAX_DAYS = 30

const minute = atom({ plugin: 'prayer-times', key: 'minute' } as const, 0)
const footer = atom({ plugin: 'prayer-times', key: 'footer' } as const, null as string | null)
const done = atom({ plugin: 'prayer-times', key: 'done' } as const, [] as string[])
const shownDay = atom({ plugin: 'prayer-times', key: 'day' } as const, 0)
const prayed = atom({ plugin: 'prayer-times', key: 'prayed' } as const, {} as Record<string, string[]>)
const prefs = atom({ plugin: 'prayer-times', key: 'prefs' } as const, {} as Prefs)
const editing = atom({ plugin: 'prayer-times', key: 'editing' } as const, false)
const notice = atom({ plugin: 'prayer-times', key: 'notice' } as const, '')

type Sound = 'chime' | 'voice' | 'off'
type Config = { settings: Settings; place: string; source: 'pane' | 'settings' | 'zone'; sound: Sound }

const dayKey = (at: Date) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

const until = (at: Date, now: Date) => {
  const minutes = Math.ceil((at.getTime() - now.getTime()) / 60000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

const hijri = (at: Date) => {
  try {
    return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(at)
  } catch {
    return null
  }
}

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return ''
  }
}

let chime: string | null = null
// The plugin's /config values, as it loaded.
let options: Record<string, unknown> = {}

// The settings in force: what was set in the pane, else in /config, else a guess
// from the machine's time zone.
function configFor(p: Prefs): Config {
  const guess = guessFromZone(zone())
  const latitude = Number(options.latitude) || 0
  const longitude = Number(options.longitude) || 0
  const source: Config['source'] =
    typeof p.latitude === 'number' && typeof p.longitude === 'number'
      ? 'pane'
      : latitude === 0 && longitude === 0
        ? 'zone'
        : 'settings'
  const at =
    source === 'pane' ? { latitude: p.latitude!, longitude: p.longitude! } : source === 'settings' ? { latitude, longitude } : guess
  const coords = `${at.latitude.toFixed(2)}, ${at.longitude.toFixed(2)}`
  const place = source === 'pane' ? p.place || coords : source === 'settings' ? String(options.place || '') || coords : guess.city
  const chosen = String(p.method ?? options.method ?? 'auto')
  const method = (chosen in METHOD_NAMES ? chosen : guess.method) as Method
  const asr: AsrMethod = (p.asr ?? options.asr) === 'Hanafi' ? 'Hanafi' : 'Standard'
  const sound = String(p.sound ?? options.sound)
  return {
    settings: { latitude: at.latitude, longitude: at.longitude, method, asr },
    place,
    source,
    sound: sound === 'voice' || sound === 'off' ? sound : 'chime',
  }
}

const statusText = (now: Date, config: Config) => {
  const next = nextPrayer(now, config.settings)
  const soon = next.at.getTime() - now.getTime() < 60 * 60 * 1000
  return soon ? `${label(next.name, next.at)} in ${until(next.at, now)}` : `${label(next.name, next.at)} ${clock(next.at)}`
}

const dayFrom = (at: Date, offset: number) => new Date(at.getFullYear(), at.getMonth(), at.getDate() + offset)

// Whose time it is now: Fajr runs to sunrise, Isha to the next Fajr, and between
// sunrise and Dhuhr it is no prayer's.
function windowAt(now: Date, s: Settings) {
  const today = prayerTimes(now, s)
  const at = (name: PrayerName, start: Date, end: Date) => ({ name, start, end })
  if (now < today.Fajr) return at('Isha', prayerTimes(dayFrom(now, -1), s).Isha, today.Fajr)
  if (now < today.Sunrise) return at('Fajr', today.Fajr, today.Sunrise)
  if (now < today.Dhuhr) return null
  if (now < today.Asr) return at('Dhuhr', today.Dhuhr, today.Asr)
  if (now < today.Maghrib) return at('Asr', today.Asr, today.Maghrib)
  if (now < today.Isha) return at('Maghrib', today.Maghrib, today.Isha)
  return at('Isha', today.Isha, prayerTimes(dayFrom(now, 1), s).Fajr)
}

// The prayer time the wait for the next one began at: today's, or yesterday's Isha.
function previousAt(now: Date, s: Settings) {
  const today = prayerTimes(now, s)
  const begun = PRAYERS.map(name => today[name]).filter(at => at <= now)
  return begun[begun.length - 1] ?? prayerTimes(dayFrom(now, -1), s).Isha
}

// The pane's settings live in the store, so they outlast the session; state
// carries them to the drawings.
async function setPrefs($: EngineInterface, change: (p: Prefs) => Prefs) {
  const value = change(((await $.store.get('prefs')) ?? {}) as Prefs)
  await $.store.set('prefs', value)
  await update($, prefs, () => value)
  await update($, footer, () => statusText(new Date(), configFor(value)))
}

async function setLocation($: EngineInterface, text: string) {
  const place = parseLocation(text)
  if (!place) {
    await update($, notice, () => `Couldn't place "${text.trim()}". Try a city, or latitude, longitude such as 38.85, -77.31.`)
    return
  }
  await update($, notice, () => '')
  await setPrefs($, p => ({ ...p, ...place }))
}

// Marks a prayer prayed (or not), in the store as the record of it.
async function markPrayed($: EngineInterface, day: string, name: PrayerName, isPrayed?: boolean) {
  const stored = ((await $.store.get('prayed')) ?? {}) as Record<string, string[]>
  const list = stored[day] ?? []
  const want = isPrayed ?? !list.includes(name)
  const marked = want ? [...new Set([...list, name])] : list.filter(one => one !== name)
  // Two months is more than the week's rings need, and keeps the store small.
  const cutoff = dayKey(new Date(Date.now() - 60 * 86400000))
  const value = Object.fromEntries(
    Object.entries({ ...stored, [day]: marked }).filter(([key, names]) => key >= cutoff && names.length > 0),
  )
  await $.store.set('prayed', value)
  await update($, prayed, () => value)
}

// Another chat may have marked a prayer or moved the location since: the store
// is the record, state a copy of it.
async function sync($: EngineInterface) {
  const storedPrayed = ((await $.store.get('prayed')) ?? {}) as Record<string, string[]>
  if (JSON.stringify(storedPrayed) !== JSON.stringify(await read($, prayed))) await update($, prayed, () => storedPrayed)
  const storedPrefs = ((await $.store.get('prefs')) ?? {}) as Prefs
  if (JSON.stringify(storedPrefs) !== JSON.stringify(await read($, prefs))) await update($, prefs, () => storedPrefs)
}

async function playReminder($: EngineInterface, config: Config, text: string) {
  try {
    if (config.sound === 'chime') {
      chime ??= toBase64(chimeWav())
      await $.audio.play({ base64: chime, mime: 'audio/wav' })
    } else if (config.sound === 'voice') {
      await $.audio.speak(text)
    }
  } catch {
    // No audio device: the notice is enough.
  }
}

// Every chat checks; the first to see a new prayer claims it in the shared
// store, so only one plays the sound.
async function tick($: EngineInterface) {
  const now = new Date(await $.clock.now())
  const stamp = Math.floor(now.getTime() / 60000)
  if ((await read($, minute)) !== stamp) {
    await update($, minute, () => stamp)
    await sync($)
  }
  const config = configFor(await read($, prefs))
  const text = statusText(now, config)
  if ((await read($, footer)) !== text) await update($, footer, () => text)

  const current = currentPrayer(now, config.settings, ANNOUNCE_WINDOW_MS)
  if (!current) return
  const key = `announced:${dayKey(current.at)}:${current.name}`
  if (await $.store.get(key)) return
  await $.store.set(key, now.getTime())
  const name = label(current.name, current.at)
  $.ui.toast(`Time for ${name} (${clock(current.at)})`)
  await playReminder($, config, `Time for ${name}`)
}

// Everything the pane draws, worked out once for both of its drawings.
function paneData(now: Date, offset: number, config: Config, marks: Record<string, string[]>) {
  const s = config.settings
  const shown = dayFrom(now, offset)
  const times = prayerTimes(shown, s)
  const key = dayKey(shown)
  const isToday = offset === 0
  const upcoming = nextPrayer(now, s)
  const nextName = isToday && dayKey(upcoming.at) === key ? upcoming.name : null
  const period = isToday ? windowAt(now, s) : null
  const nowName = period && dayKey(period.start) === key ? period.name : null
  const marked = marks[key] ?? []

  const rows = PRAYERS.map(name => {
    const at = times[name]
    const hasBegun = offset < 0 || (isToday && at <= now)
    return {
      name,
      at,
      label: label(name, at),
      time: clock(at),
      isNext: name === nextName,
      isNow: name === nowName,
      isPast: hasBegun && name !== nowName,
      hasBegun,
      isPrayed: marked.includes(name),
    }
  })

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const day = dayFrom(now, i - 6)
    const count = (marks[dayKey(day)] ?? []).filter(name => (PRAYERS as string[]).includes(name)).length
    return {
      letter: day.toLocaleDateString([], { weekday: 'narrow' }),
      count,
      isToday: i === 6,
      title: `${day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} · ${count} of 5 prayed`,
    }
  })

  const daylight = Math.round((times.Maghrib.getTime() - times.Sunrise.getTime()) / 60000)
  const nextLabel = label(upcoming.name, upcoming.at)
  const isTomorrow = dayKey(upcoming.at) !== dayKey(now)
  const card = isToday
    ? {
        eyebrow: 'Next prayer',
        heading: nextLabel,
        detail: `${clock(upcoming.at)}${isTomorrow ? ' tomorrow' : ''} · in ${until(upcoming.at, now)}`,
        progress: (() => {
          const from = previousAt(now, s).getTime()
          return (now.getTime() - from) / Math.max(1, upcoming.at.getTime() - from)
        })(),
        pill: period
          ? period.name === 'Fajr'
            ? `Fajr ends at sunrise, ${clock(period.end)}`
            : `${label(period.name, period.start)} time`
          : null,
      }
    : {
        eyebrow: offset > 0 ? 'Looking ahead' : 'Looking back',
        heading: offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : offset > 0 ? `In ${offset} days` : `${-offset} days ago`,
        detail: `Sunrise ${clock(times.Sunrise)} · Maghrib ${clock(times.Maghrib)}`,
        progress: null,
        pill: `${Math.floor(daylight / 60)}h ${String(daylight % 60).padStart(2, '0')}m of daylight`,
      }

  const q = qibla(s.latitude, s.longitude)
  const methodName = METHOD_NAMES[s.method]
  return {
    shown,
    key,
    times,
    isToday,
    rows,
    weekDays,
    weekTotal: weekDays.reduce((sum, d) => sum + d.count, 0),
    card,
    nextLabel,
    upcoming,
    nextName,
    date: shown.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }),
    islamic: hijri(shown),
    qibla: { degrees: Math.round(q.bearing), point: compassPoint(q.bearing), bearing: q.bearing, km: Math.round(q.km) },
    placeLine: `${config.place}${config.source === 'zone' ? ' (from your time zone)' : ''} · ${methodName} · Asr ${s.asr}`,
  }
}

const METHOD_OPTIONS = [
  { value: 'auto', label: 'Auto: the one most used in your time zone' },
  ...Object.entries(METHOD_NAMES).map(([value, name]) => ({ value, label: name })),
]
const ASR_OPTIONS = [
  { value: 'Standard', label: "Standard (Shafi'i, Maliki, Hanbali)" },
  { value: 'Hanafi', label: 'Hanafi' },
]
const SOUND_OPTIONS = [
  { value: 'chime', label: 'A soft chime' },
  { value: 'voice', label: 'A spoken reminder' },
  { value: 'off', label: 'Nothing' },
]

type Controls = Pick<Elements['desktop'], 'Box' | 'Text' | 'Button' | 'Input' | 'Select'>

// The pane's own settings: what /config holds, reachable where /config is not
// (the desktop app), and winning over it once set here.
function settingsEditor($: EngineInterface, { Box, Text, Button, Input, Select }: Controls, config: Config, p: Prefs, message: string) {
  return (
    <Box flexDirection="column" gap={1}>
      <Input
        key="location"
        label="Location"
        placeholder="A city, or latitude, longitude"
        submitLabel="set"
        onSubmit={value => void setLocation($, value)}
      />
      {message ? <Text color="yellow">{message}</Text> : <Text dimColor>Now: {config.place}</Text>}
      <Select
        key="method"
        label="Method"
        options={METHOD_OPTIONS}
        value={String(p.method ?? options.method ?? 'auto')}
        onSelect={value => void setPrefs($, current => ({ ...current, method: value }))}
      />
      <Select
        key="asr"
        label="Asr"
        options={ASR_OPTIONS}
        value={config.settings.asr}
        onSelect={value => void setPrefs($, current => ({ ...current, asr: value }))}
      />
      <Select
        key="sound"
        label="At adhan"
        options={SOUND_OPTIONS}
        value={config.sound}
        onSelect={value => void setPrefs($, current => ({ ...current, sound: value }))}
      />
      <Box gap={1} flexWrap="wrap">
        <Button key="hear" label="Play it" onPress={() => void playReminder($, config, 'Time for prayer')} />
        {Object.keys(p).length > 0 && (
          <Button
            key="reset"
            label="Use /config instead"
            onPress={() => {
              void update($, notice, () => '')
              void setPrefs($, () => ({}))
            }}
          />
        )}
        <Button key="close-settings" label="Done" variant="primary" onPress={() => void update($, editing, () => false)} />
      </Box>
    </Box>
  )
}

export const register: Register = (on, loaded) => {
  options = loaded

  // Shown among the prompt footer's labels, where no plugin name is drawn beside it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = await read($, footer)
    return text ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } }) : next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prayer', description: "Today's prayer times" })
    await sync($)
    void tick($)
    $.clock.every(20 * 1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'prayer' }, async ($, e) => {
    await update($, shownDay, () => 0)
    await $.ui.open({ id: PANE, title: 'Prayer times' })

    return { text: 'Prayer times opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, minute)
    const dismissed = await read($, done)
    const config = configFor(await read($, prefs))
    const now = new Date()
    const upcoming = nextPrayer(now, config.settings)
    const current = currentPrayer(now, config.settings, AFTER_MS)
    const soon = upcoming.at.getTime() - now.getTime() <= BEFORE_MS
    const showing = current && !dismissed.includes(`${dayKey(current.at)}:${current.name}`) ? current : soon ? upcoming : null
    if (e.props.hasSurvey || !showing) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const below = await next(e)
    const isNow = showing === current
    const name = label(showing.name, showing.at)
    const id = `${dayKey(showing.at)}:${showing.name}`

    return (
      <Box flexDirection="column">
        <Box gap={1} alignItems="center" marginBottom={1}>
          <Text color={isNow ? 'green' : 'yellow'}>●</Text>
          <Text bold>{isNow ? `${name} now` : `${name} in ${until(showing.at, now)}`}</Text>
          <Text dimColor>· {clock(showing.at)}</Text>
          {isNow && (
            <Button
              key="prayer-done"
              label="Done"
              plain
              dimColor
              onPress={async () => {
                await update($, done, list => [...list, id].slice(-20))
                await markPrayed($, dayKey(showing.at), showing.name, true)
              }}
            />
          )}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, minute)
    const offset = await read($, shownDay)
    const marks = await read($, prayed)
    const p = await read($, prefs)
    const isEditing = await read($, editing)
    const message = await read($, notice)
    const config = configFor(p)
    const now = new Date()
    const d = paneData(now, offset, config, marks)

    const step = (by: number) => () => void update($, shownDay, day => Math.max(-MAX_DAYS, Math.min(MAX_DAYS, day + by)))
    const toggle = (row: (typeof d.rows)[number]) => () => {
      if (!row.hasBegun) {
        $.ui.toast(`${row.label} hasn't begun yet`)
        return
      }
      void markPrayed($, d.key, row.name)
    }

    // The terminal draws no pictures: the same pane in text.
    if (e.surface === 'terminal') {
      const ui = $.ui.resolve(e)
      const { Box, Text, Button } = ui
      return (
        <Box flexDirection="column" gap={1}>
          <Box justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Box flexDirection="column">
              <Text bold>{d.date}</Text>
              {d.islamic && <Text dimColor>{d.islamic}</Text>}
            </Box>
            <Box gap={1}>
              <Button key="day-back" label="‹" plain onPress={step(-1)} />
              {offset !== 0 && <Button key="day-today" label="today" plain onPress={() => void update($, shownDay, () => 0)} />}
              <Button key="day-forward" label="›" plain onPress={step(1)} />
            </Box>
          </Box>

          <Box flexDirection="column">
            <Text bold color={d.isToday ? 'green' : undefined}>
              {d.card.heading}
              {d.isToday ? ` in ${until(d.upcoming.at, now)}` : ''}
            </Text>
            <Text dimColor>{d.isToday ? `${clock(d.upcoming.at)}${d.card.pill ? ` · ${d.card.pill}` : ''}` : d.card.detail}</Text>
          </Box>

          <Box flexDirection="column">
            {d.rows.map(row => [
              <Box key={`row-${row.name}`} gap={2}>
                <Text bold={row.isNext || row.isNow} color={row.isNext ? 'green' : undefined} dimColor={row.isPast}>
                  {(row.isNext ? '▸ ' : row.isNow ? '• ' : '  ') + row.label.padEnd(9)}
                </Text>
                <Text bold={row.isNext} color={row.isNext ? 'green' : undefined} dimColor={row.isPast}>
                  {row.time.padStart(8)}
                </Text>
                <Button key={`pray-${row.name}`} label={row.isPrayed ? '✓' : '○'} plain dimColor={!row.isPrayed} onPress={toggle(row)} />
              </Box>,
              row.name === 'Fajr' && (
                <Box key="row-Sunrise" gap={2}>
                  <Text dimColor>{'  ' + 'Sunrise'.padEnd(9)}</Text>
                  <Text dimColor>{clock(d.times.Sunrise).padStart(8)}</Text>
                </Box>
              ),
            ])}
          </Box>

          <Box gap={1} flexWrap="wrap">
            <Text dimColor>This week</Text>
            {d.weekDays.map((day, i) => (
              <Text key={`week-${i}`} bold={day.isToday} color={day.count >= 5 ? 'green' : undefined} dimColor={day.count === 0}>
                {`${day.letter}${day.count >= 5 ? '✓' : day.count}`}
              </Text>
            ))}
          </Box>

          <Box flexDirection="column">
            <Text dimColor>
              Qibla {d.qibla.degrees}° {d.qibla.point} · {d.qibla.km.toLocaleString()} km to Makkah
            </Text>
            <Text dimColor>{d.placeLine}</Text>
          </Box>
          {isEditing ? (
            settingsEditor($, ui, config, p, message)
          ) : (
            <Button key="open-settings" label="Location & settings" plain dimColor onPress={() => void update($, editing, () => true)} />
          )}
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const labels = Object.fromEntries(ORDER.map(name => [name, label(name, d.times[name])])) as Record<PrayerName, string>
    const clocks = Object.fromEntries(ORDER.map(name => [name, clock(d.times[name])])) as Record<PrayerName, string>
    const sky = hero({
      day: d.shown,
      now: d.isToday ? now : null,
      latitude: config.settings.latitude,
      longitude: config.settings.longitude,
      times: d.times,
      labels,
      clocks,
      next: d.nextName,
      ...d.card,
    })
    const skyAlt = d.isToday
      ? `The sun's path across today's sky. Next prayer: ${d.nextLabel} at ${clock(d.upcoming.at)}, in ${until(d.upcoming.at, now)}.`
      : `The sun's path across the sky on ${d.date}, with each prayer time marked.`

    return (
      <Box flexDirection="column" gap={1}>
        <Box justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
          <Box flexDirection="column">
            <Text bold>{d.date}</Text>
            {d.islamic && <Text dimColor>{d.islamic}</Text>}
          </Box>
          <Box gap={1}>
            <Button key="day-back" label="‹" onPress={step(-1)} />
            {offset !== 0 && <Button key="day-today" label="Today" onPress={() => void update($, shownDay, () => 0)} />}
            <Button key="day-forward" label="›" onPress={step(1)} />
          </Box>
        </Box>

        <Svg source={sky} alt={skyAlt} isInteractive />

        <Box flexDirection="column">
          {d.rows.map(row => [
            <Box key={`row-${row.name}`} gap={1} alignItems="center">
              <Svg source={icon(row.name, row.isPast)} alt={row.label} width={18} height={18} />
              <Box flexGrow={1} gap={1}>
                <Text bold={row.isNext || row.isNow} color={row.isNext ? 'green' : undefined} dimColor={row.isPast}>
                  {row.label}
                </Text>
                {row.isNow && <Text color="green">now</Text>}
                {row.isNext && <Text dimColor>in {until(row.at, now)}</Text>}
              </Box>
              <Text bold={row.isNext} color={row.isNext ? 'green' : undefined} dimColor={row.isPast}>
                {row.time}
              </Text>
              <Button key={`pray-${row.name}`} label={row.isPrayed ? '✓' : '○'} plain dimColor={!row.isPrayed} onPress={toggle(row)} />
            </Box>,
            row.name === 'Fajr' && (
              <Box key="row-Sunrise" gap={1} alignItems="center">
                <Svg source={icon('Sunrise', d.isToday ? d.times.Sunrise <= now : offset < 0)} alt="Sunrise" width={18} height={18} />
                <Text dimColor>Sunrise {clock(d.times.Sunrise)}</Text>
              </Box>
            ),
          ])}
        </Box>

        <Box flexDirection="column">
          <Box gap={1}>
            <Text bold>This week</Text>
            <Text dimColor>{d.weekTotal} of 35 prayed</Text>
          </Box>
          <Svg
            source={week(d.weekDays)}
            alt={`Prayers marked this week: ${d.weekDays.map(day => `${day.letter} ${day.count}`).join(', ')}`}
            isInteractive
          />
          {d.weekTotal === 0 && <Text dimColor>Press ○ beside a prayer once you've prayed it, and the rings fill.</Text>}
        </Box>

        <Box gap={2} alignItems="center">
          <Svg source={compass(d.qibla.bearing)} alt={`Qibla ${d.qibla.degrees}° ${d.qibla.point}`} width={48} height={48} />
          <Box flexDirection="column" flexGrow={1}>
            <Box gap={1}>
              <Text>Qibla</Text>
              <Text bold>
                {d.qibla.degrees}° {d.qibla.point}
              </Text>
              <Text dimColor>· {d.qibla.km.toLocaleString()} km to Makkah</Text>
            </Box>
            <Text dimColor>{d.placeLine}</Text>
          </Box>
        </Box>

        {e.surface !== 'mobile' &&
          (isEditing ? (
            settingsEditor($, $.ui.resolve(e), config, p, message)
          ) : (
            <Button key="open-settings" label="Location & settings" plain dimColor onPress={() => void update($, editing, () => true)} />
          ))}
      </Box>
    )
  })
}

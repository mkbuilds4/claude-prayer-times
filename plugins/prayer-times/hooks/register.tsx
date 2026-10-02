import type { EngineInterface, Register } from 'claude-code'

import { chimeWav, toBase64 } from './chime'
import {
  clock,
  currentPrayer,
  guessFromZone,
  label,
  METHOD_NAMES,
  nextPrayer,
  ORDER,
  prayerTimes,
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

const minute = { plugin: 'prayer-times', key: 'minute' } as const
const footer = { plugin: 'prayer-times', key: 'footer' } as const
const done = { plugin: 'prayer-times', key: 'done' } as const

type Config = { settings: Settings; place: string; guessed: boolean; sound: 'chime' | 'voice' | 'off' }

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

let chime: string | null = null
// Read from the plugin's options when it loads; see readConfig.
let config: Config

function readConfig(options: Record<string, unknown>) {
  // Settings, with anything unset guessed from the machine's time zone.
  const zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return ''
    }
  })()
  const guess = guessFromZone(zone)
  const latitude = Number(options.latitude) || 0
  const longitude = Number(options.longitude) || 0
  const guessed = latitude === 0 && longitude === 0
  const method = (options.method && options.method !== 'auto' ? options.method : guess.method) as Method
  config = {
    settings: {
      latitude: guessed ? guess.latitude : latitude,
      longitude: guessed ? guess.longitude : longitude,
      method,
      asr: (options.asr === 'Hanafi' ? 'Hanafi' : 'Standard') as AsrMethod,
    },
    place: String(options.place || '') || (guessed ? guess.city : `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`),
    guessed,
    sound: (['chime', 'voice', 'off'].includes(String(options.sound)) ? options.sound : 'chime') as Config['sound'],
  }
}

const statusText = (now: Date) => {
  const next = nextPrayer(now, config.settings)
  const soon = next.at.getTime() - now.getTime() < 60 * 60 * 1000
  return soon ? `${label(next.name, next.at)} in ${until(next.at, now)}` : `${label(next.name, next.at)} ${clock(next.at)}`
}

// Every chat checks; the first to see a new prayer claims it in the shared
// store, so only one plays the sound.
async function tick($: EngineInterface) {
  const now = new Date(await $.clock.now())
  await $.state.set(minute, Math.floor(now.getTime() / 60000))
  await $.state.set(footer, statusText(now))

  const current = currentPrayer(now, config.settings, ANNOUNCE_WINDOW_MS)
  if (!current) return
  const key = `announced:${dayKey(current.at)}:${current.name}`
  if (await $.store.get(key)) return
  await $.store.set(key, now.getTime())
  const name = label(current.name, current.at)
  $.ui.toast(`Time for ${name} (${clock(current.at)})`)
  try {
    if (config.sound === 'chime') {
      chime ??= toBase64(chimeWav())
      await $.audio.play({ base64: chime, mime: 'audio/wav' })
    } else if (config.sound === 'voice') {
      await $.audio.speak(`Time for ${name}`)
    }
  } catch {
    // No audio device: the notice is enough.
  }
}

export const register: Register = (on, options) => {
  readConfig(options)

  // Shown among the prompt footer's labels, where no plugin name is drawn beside it.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { value: text } = await $.state.get(footer)
    return text ? next({ ...e, props: { ...e.props, modes: [...e.props.modes, text] } }) : next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prayer', description: "Today's prayer times" })
    void tick($)
    $.clock.every(20 * 1000, () => void tick($))

    return next(e)
  })

  on('command.run', { command: 'prayer' }, async ($, e) => {
    await $.ui.open({ id: PANE, title: 'Prayer times' })

    return { text: 'Prayer times opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await $.state.get(minute)
    const { value: dismissed = [] } = await $.state.get(done)
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
          {isNow && <Button key="prayer-done" label="Done" plain dimColor onPress={() => $.state.set(done, [...dismissed, id].slice(-20))} />}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await $.state.get(minute)
    const { Box, Text } = $.ui.resolve(e)
    const now = new Date()
    const today = prayerTimes(now, config.settings)
    const tomorrow = prayerTimes(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), config.settings)
    const upcoming = nextPrayer(now, config.settings)
    const isNext = (name: PrayerName, at: Date) => upcoming.name === name && upcoming.at.getTime() === at.getTime()
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    const islamic = hijri(now)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{date}</Text>
          {islamic && <Text dimColor>{islamic}</Text>}
        </Box>

        <Box flexDirection="column">
          {ORDER.map(name => {
            const at = today[name]
            const past = at < now && !isNext(name, at)
            const next = isNext(name, at)
            return (
              <Box key={`row-${name}`} gap={2}>
                <Text bold={next} color={next ? 'green' : undefined} dimColor={past || name === 'Sunrise'}>
                  {(next ? '▸ ' : '  ') + label(name, at).padEnd(9)}
                </Text>
                <Text bold={next} color={next ? 'green' : undefined} dimColor={past}>
                  {clock(at)}
                </Text>
                {next && <Text dimColor>in {until(at, now)}</Text>}
              </Box>
            )
          })}
          <Box gap={2}>
            <Text color={isNext('Fajr', tomorrow.Fajr) ? 'green' : undefined} dimColor={!isNext('Fajr', tomorrow.Fajr)}>
              {(isNext('Fajr', tomorrow.Fajr) ? '▸ ' : '  ') + 'Fajr'.padEnd(9)}
            </Text>
            <Text dimColor>{clock(tomorrow.Fajr)} tomorrow</Text>
          </Box>
        </Box>

        <Text dimColor>
          {config.place}
          {config.guessed ? ' (from your time zone)' : ''} · {METHOD_NAMES[config.settings.method]} · Asr {config.settings.asr}
        </Text>
        {config.guessed && (
          <Text dimColor>For exact times, set your latitude and longitude in /config under prayer-times.</Text>
        )}
      </Box>
    )
  })
}

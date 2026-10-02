export type PrayerTimesTick = number

// What the pane's own settings hold; each one set there wins over /config.
export type PrayerTimesPrefs = {
  latitude?: number
  longitude?: number
  place?: string
  method?: string
  asr?: string
  sound?: string
}

declare module 'claude-code' {
  interface PluginState {
    'prayer-times': {
      // The text this mod adds to the prompt footer's labels.
      footer: string | null
      // The current minute, rewritten when it changes so drawings that show a
      // countdown redraw.
      minute: PrayerTimesTick
      // Prayers whose reminder row was dismissed, as "YYYY-MM-DD:Name".
      done: string[]
      // Which day the pane shows, in days from today.
      day: number
      // Prayers marked as prayed, by "YYYY-MM-DD"; the store keeps the record.
      prayed: Record<string, string[]>
      // The pane's own settings; the store keeps the record.
      prefs: PrayerTimesPrefs
      // Whether the pane's settings are open.
      editing: boolean
      // The line under the location field when it could not place what was typed.
      notice: string
    }
  }
}

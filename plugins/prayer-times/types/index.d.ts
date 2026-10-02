export type PrayerTimesTick = number

declare module 'claude-code' {
  interface PluginState {
    'prayer-times': {
      // The text this mod adds to the prompt footer's labels.
      footer: string | null
      // The current minute, rewritten every 20 seconds so drawings that show a
      // countdown redraw.
      minute: PrayerTimesTick
      // Prayers whose reminder row was dismissed, as "YYYY-MM-DD:Name".
      done: string[]
    }
  }
}

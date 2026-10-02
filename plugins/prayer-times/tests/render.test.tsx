import { expect, mock, test, type Mounted } from 'claude-code/testing'

// The host's $.state, held in memory with a version per key, as `update` writes on the version
// it read. The test's own hooks stand for the engine, so the state answers are registered on the
// test's `on`; under the kit each call resolves to the answer's `value` field, so what a session
// would return ({ value, version } for a read, { isSet, version } for a write) goes inside it.
const answerState = (on: any, initial: Record<string, unknown> = {}) => {
  const rows = new Map<string, { value: unknown; version: number }>(
    Object.entries(initial).map(([key, value]) => [key, { value, version: 1 }]),
  )
  on('state.get', async (_: unknown, e: any) => ({ value: rows.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', async (_: unknown, e: any) => {
    const version = rows.get(e.key)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    rows.set(e.key, { value: e.value, version: version + 1 })
    return { value: { isSet: true, version: version + 1 } }
  })
  return rows
}

// The plugin's store, held in memory so a test can read back what the plugin wrote.
const answerStore = (on: any) => {
  const stored = new Map<string, unknown>()
  on('store.get', async (_: unknown, e: any) => ({ value: stored.get(e.key) }))
  on('store.set', async (_: unknown, e: any) => {
    stored.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return stored
}

const PANE = {
  component: 'Pane',
  requestId: 'prayer-times',
  props: { title: 'Prayer times', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
}

const yesterday = () => {
  const day = new Date()
  day.setDate(day.getDate() - 1)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

test('the pane draws on every surface, pictures where the surface has them', async ($, on) => {
  answerState(on)
  mock.store(on)
  mock.clock(on, { now: Date.now() })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const pane = await $.ui.mount({ plugin: 'prayer-times', surface, ...PANE } as never)
    for (const name of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) expect(await pane.find({ key: `pray-${name}` })).toBeDefined()
    expect(await pane.find({ key: 'day-back' })).toBeDefined()
    expect(await pane.find({ key: 'day-forward' })).toBeDefined()
    expect(await pane.find({ key: 'day-today' })).toBeUndefined()
    if (surface === 'terminal') expect(await pane.find({ type: 'Svg' } as never)).toBeUndefined()
    else expect(await pane.find({ type: 'Svg' } as never)).toBeDefined()
    if (surface === 'mobile') expect(await pane.find({ key: 'open-settings' })).toBeUndefined()
    else expect(await pane.find({ key: 'open-settings' })).toBeDefined()
    await pane.unmount()
  }
})

test('another day shows a way back to today', async ($, on) => {
  answerState(on, { day: 1 })
  mock.store(on)
  mock.clock(on, { now: Date.now() })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'prayer-times', surface, ...PANE } as never)
    expect(await pane.find({ key: 'day-today' })).toBeDefined()
    await pane.unmount()
  }
})

test("marking yesterday's Fajr prayed keeps it in the store", async ($, on) => {
  answerState(on, { day: -1 })
  const written = answerStore(on)
  mock.clock(on, { now: Date.now() })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'prayer-times', surface, ...PANE } as never)
    await pane.press({ key: 'pray-Fajr' } as never)
    const marked = written.get('prayed') as Record<string, string[]>
    // A press toggles, so the second surface's press takes the first one's mark back off.
    expect(marked[yesterday()]?.includes('Fajr') ?? false).toBe(surface === 'terminal')
    await pane.unmount()
  }
})

test('a place typed in the settings moves the times there', async ($, on) => {
  answerState(on, { editing: true })
  const written = answerStore(on)
  mock.clock(on, { now: Date.now() })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = (await $.ui.mount({ plugin: 'prayer-times', surface, ...PANE } as never)) as Mounted<typeof surface, 'Pane'>
    await pane.input({ key: 'location', text: 'Northern Virginia' } as never)
    const prefs = written.get('prefs') as { latitude?: number; place?: string }
    expect(prefs.latitude).toBe(38.85)
    expect(prefs.place).toBe('Northern Virginia')
    await pane.unmount()
  }
})

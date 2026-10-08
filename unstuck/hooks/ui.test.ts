import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const ERROR = "Exit code 1\nTypeError: Cannot read properties of undefined (reading 'map')"

/** What a session has beneath the plugins: a clock, a store, a cost ledger. */
// ponytail: partial props, the kit fills what a surface measures
const PANE = { isFocused: true, bodyColumns: 80, placement: 'dock' } as never
const BAND = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100 } as never

const host = (on: On) => {
  on('clock.now', () => ({ value: 1_000_000 }))
  on('store.set', () => ({ value: undefined }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, percent: 10 }, rateLimits: {}, cost: { usd: 0.5 } } as never,
  }))
}

test('settings pane draws and toggles', async ($, on) => {
  host(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'unstuck',
      surface,
      component: 'Pane',
      requestId: 'unstuck-settings',
      props: PANE,
    })
    expect((await ui.find({ key: 'blockHacks' }))?.text).toContain('○')
    await ui.press({ key: 'blockHacks' })
    expect((await ui.find({ key: 'blockHacks' }))?.text).toContain('◉')
    await ui.press({ key: 'blockHacks' })
    await ui.unmount()
  }
})

test('three identical Bash errors: nudge, red band, menu', async ($, on) => {
  host(on)
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true as const, result: ERROR, text: ERROR }))

  const results = []
  for (let i = 0; i < 3; i++) {
    results.push(await $.tool.call({ tool: 'Bash', command: 'node -e "undefined.map()"' }))
  }
  expect(results[1]?.context ?? []).toEqual([])
  expect(results[2]?.context?.[0]).toContain('[unstuck] You are going in circles (same error 3×)')

  for (const surface of SURFACES) {
    const band = await $.ui.mount({
      plugin: 'unstuck',
      surface,
      component: 'AbovePrompt',
      props: BAND,
    })
    expect(await band.find({ type: 'Text', text: /Claude is stuck · same error 3×/ })).toBeDefined()
    expect(await band.find({ key: 'restart' })).toBeDefined()
    await band.unmount()
  }

  for (const surface of SURFACES) {
    const menu = await $.ui.mount({
      plugin: 'unstuck',
      surface,
      component: 'Pane',
      requestId: 'unstuck',
      props: PANE,
    })
    expect(await menu.find({ key: 'diagnose' })).toBeDefined()
    expect(await menu.find({ type: 'Text', text: /Claude is stuck/ })).toBeDefined()
    await menu.unmount()
  }

  const menu = await $.ui.mount({
    plugin: 'unstuck',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'unstuck',
    props: PANE,
  })
  await menu.press({ key: 'reset' })
  expect(await menu.find({ type: 'Text', text: /All good/ })).toBeDefined()
  await menu.unmount()
})

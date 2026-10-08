import { expect, test } from 'claude-code/testing'

import {
  bump,
  claimsFix,
  DEFAULTS,
  EMPTY,
  hacksAdded,
  freshDeadEnds,
  isGreen,
  isHealthCheck,
  looksFailed,
  isPingPong,
  levelOf,
  normalize,
  onError,
  onSuccess,
  reasonsOf,
} from './detect'

const err = (line: number) =>
  `Exit code 1\nTypeError: Cannot read properties of undefined (reading 'map')\n    at C:\\app\\src\\List.tsx:${line}:12`

const fail = (t = EMPTY, text = err(1), cmd = 'npm test') => onError(t, text, cmd, 0, 0)

test('same error with moved line numbers counts as a repeat, and escalates', () => {
  expect(normalize(err(10))).toBe(normalize(err(42)))

  let t = fail()
  expect(levelOf(t, DEFAULTS)).toBe('green')
  t = fail(t, err(11))
  expect(levelOf(t, DEFAULTS)).toBe('yellow')
  t = fail(t, err(12))
  expect(levelOf(t, DEFAULTS)).toBe('red')
  expect(reasonsOf(t, DEFAULTS)[0]).toBe('same error 3×')
  expect(t.excerpt).toBe("TypeError: Cannot read properties of undefined (reading 'map')")
})

const TYPE_ERROR = "TypeError: Cannot read properties of undefined (reading 'map')"

test('two different tests with the same error message are two failures, not a repeat', () => {
  const cart = `✖ cart total (1.2ms)\n${TYPE_ERROR}\n    at total (/home/u/shop/cart.js:5:3)`
  const users = `✖ user list (0.8ms)\n${TYPE_ERROR}\n    at list (/home/u/shop/users.js:9:1)`
  expect(normalize(cart)).not.toBe(normalize(users))

  const t = fail(fail(EMPTY, cart), users)
  expect(t.repeats).toBe(1)
  expect(levelOf(t, { ...DEFAULTS, detectCommand: false })).toBe('green')
})

test('the same error thrown from two different files is two failures', () => {
  const a = `${TYPE_ERROR}\n    at C:\\shop\\src\\cart.js:5:3`
  const b = `${TYPE_ERROR}\n    at C:\\shop\\src\\users.js:5:3`
  expect(normalize(a)).not.toBe(normalize(b))
})

test('a changing actual value is progress, not a repeat', () => {
  const run = (actual: string) => `✖ discount (3.1ms)\nAssertionError: Expected values to be strictly equal: actual: ${actual}, expected: 53.97`
  expect(normalize(run('53.973'))).not.toBe(normalize(run('54.1')))
})

test('the same failure stays the same across durations, machines and moved lines', () => {
  const run = (ms: string, root: string, line: number) =>
    `✖ discount (${ms}ms)\nAssertionError: actual: 53.973, expected: 53.97\n    at ${root}/shop/cart.test.js:${line}:3`
  expect(normalize(run('10.4', '/home/alice', 9))).toBe(normalize(run('1.2', 'C:\\Users\\bob', 14)))
})

test('fractions and versions are values, not paths', () => {
  expect(normalize('Error: 1/4 tests passed')).not.toBe(normalize('Error: 3/4 tests passed'))
})

test('a different error on another command starts over', () => {
  const t = fail(fail(), 'SyntaxError: Unexpected token', 'node build.js')
  expect(t.repeats).toBe(1)
  expect(t.cmdFails).toBe(1)
})

test('the same command failing with ever-new errors still escalates', () => {
  let t = fail(EMPTY, 'Error: a')
  t = fail(t, 'Error: b')
  t = fail(t, 'Error: c')
  t = fail(t, 'Error: d')
  expect(t.repeats).toBe(1)
  expect(levelOf(t, DEFAULTS)).toBe('red')
  expect(reasonsOf(t, DEFAULTS)).toContain('same command failed 4×')
})

test('a phantom fix escalates to red on the second occurrence', () => {
  let t = fail()
  t = { ...t, claimedFix: claimsFix("I've fixed the map bug, it should work now.") }
  t = fail(t, err(2))
  expect(t.phantoms).toBe(1)
  expect(levelOf(t, DEFAULTS)).toBe('red')
})

test('the failing command or a passing test ends the loop; another command does not', () => {
  const t = fail(EMPTY, err(1), 'node app.js')
  expect(onSuccess(t, 'ls')).toBe(t)
  expect(onSuccess(t, 'node app.js')).toBe(EMPTY)
  expect(onSuccess(t, 'npm run test')).toBe(EMPTY)
  expect(onSuccess(EMPTY, 'npm test')).toBe(EMPTY)
})

test('tests passing after a silenced error do not end the loop nor count as green', () => {
  const t = bump(fail(EMPTY, err(1), 'npm test'), 'hacks', 1, 0)
  expect(onSuccess(t, 'npm test')).toBe(t)
  expect(isGreen(t, 'npm test')).toBe(false)
  expect(isGreen(EMPTY, 'npm test')).toBe(true)
})

test('only real test/build runs count as health checks, not the word "test"', () => {
  for (const cmd of [
    'npm test',
    'cd demo && npm test',
    'npm run build',
    'npx vitest run',
    'pytest -x',
    'python -m pytest tests/',
    'cargo test',
    'go test ./...',
    'npm test 2>&1 | tail -20',
    'node --test',
  ]) {
    expect([cmd, isHealthCheck(cmd)]).toEqual([cmd, true])
  }
  for (const cmd of ['ls tests/', 'cat build.gradle', 'mkdir build', 'git commit -m "add test"', 'echo test', 'rm -rf build']) {
    expect([cmd, isHealthCheck(cmd)]).toEqual([cmd, false])
  }
})

test('a piped test run that fails is a failure, whatever the exit code', () => {
  expect(looksFailed('npm test 2>&1 | tail -20', '✖ failing tests:\n✖ discount (2ms)')).toBe(true)
  expect(looksFailed('pytest | tail', '==== 1 failed, 2 passed in 0.3s ====')).toBe(true)
  expect(looksFailed('npx jest | tail', 'Tests:       1 failed, 4 passed, 5 total')).toBe(true)
  expect(looksFailed('npm test | tail', 'ℹ tests 3\nℹ pass 3\nℹ fail 0')).toBe(false)
  expect(looksFailed('pytest | tail', '==== 3 passed, 0 failed ====')).toBe(false)
  expect(looksFailed('cat ci.log', 'FAIL src/a.test.js')).toBe(false)
})

test('dead ends keep the last 5 and expire after 14 days', () => {
  const day = 86_400_000
  const now = Date.parse('2026-10-20')
  const entry = (date: string) => `## ${date}\n\nnote ${date}`
  const notes = ['2026-09-01', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    .map(entry)
    .join('\n')
  const kept = freshDeadEnds(notes, now)
  expect(kept).not.toContain('2026-09-01')
  expect(kept).not.toContain('2026-10-10')
  expect(kept.match(/^## /gm)?.length).toBe(5)
  expect(freshDeadEnds(entry('2026-10-01'), now + 0 * day)).toBe('')
})

test('detectors off stay green', () => {
  const off = { ...DEFAULTS, detectRepeat: false, detectCommand: false, detectPhantom: false }
  expect(levelOf(fail(fail(fail())), off)).toBe('green')
})

test('silencing markers are caught only when added, in a language they work in', () => {
  expect(hacksAdded('a.ts', 'const x = f()', '// @ts-ignore\nconst x = f() as any')).toEqual(['@ts-ignore', 'as any'])
  expect(hacksAdded('a.ts', '// @ts-ignore\nfoo()', '// @ts-ignore\nbar()')).toEqual([])
  expect(hacksAdded('a.test.js', 'it("works", ...)', 'it.skip("works", ...)')).toEqual(['.skip()'])
  expect(hacksAdded('a.py', 'x = 1', 'x = 1  # type: ignore')).toEqual(['# type: ignore'])
  expect(hacksAdded('README.md', '', 'avoid @ts-ignore and .skip()')).toEqual([])
  expect(hacksAdded('labels.py', '', "label = 'as any'")).toEqual([])
})

test('writing back replaced text is a ping-pong; edit signals add up', () => {
  expect(isPingPong(['return a + b'], 'return a + b')).toBe(true)
  expect(isPingPong(['return a + b'], 'return a - b')).toBe(false)
  expect(isPingPong([''], '')).toBe(false)

  let t = bump(EMPTY, 'pingpongs', 5, 1)
  expect(t.since).toBe(5)
  t = bump(t, 'hacks', 9, 2)
  expect(t.since).toBe(5)
  expect(levelOf(t, DEFAULTS)).toBe('yellow')
  expect(levelOf(fail(t), DEFAULTS)).toBe('red')
})

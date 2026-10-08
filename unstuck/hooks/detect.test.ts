import { expect, test } from 'claude-code/testing'

import {
  bump,
  claimsFix,
  DEFAULTS,
  EMPTY,
  hacksAdded,
  isGreen,
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

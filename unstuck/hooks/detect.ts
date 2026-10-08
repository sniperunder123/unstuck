import type { Level, Settings, Tracker } from '../types'

export const DEFAULTS: Settings = {
  detectRepeat: true,
  detectCommand: true,
  detectPhantom: true,
  detectPingPong: true,
  detectHacks: true,
  nudge: true,
  blockHacks: false,
  deadEnds: true,
  band: true,
  toast: true,
  status: true,
  yellowAt: 2,
  redAt: 3,
}

export const EMPTY: Tracker = {
  key: '',
  excerpt: '',
  failCommand: '',
  repeats: 0,
  cmdFails: 0,
  phantoms: 0,
  pingpongs: 0,
  hacks: 0,
  since: 0,
  usdAtStart: 0,
  usd: 0,
  claimedFix: false,
  nudged: false,
}

const ERROR_LINE = /error|fail|exception|cannot|can't|not found|undefined|denied|refused|panic/i

const errorLines = (text: string) => {
  const lines = text.split('\n').filter(line => ERROR_LINE.test(line))
  return lines.length > 0 ? lines : text.split('\n')
}

// ponytail: regex heuristic, swap for per-tool parsers if it misgroups errors
export const normalize = (text: string) =>
  errorLines(text)
    .join('\n')
    .replace(/[A-Za-z]:[\\/][^\s:'"()]+|(?:\.{0,2}\/)[^\s:'"()]+/g, '<path>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)

const excerptOf = (text: string) =>
  (errorLines(text).find(line => line.trim() && !/^exit code/i.test(line.trim())) ?? '').trim().slice(0, 160)

export const onError = (t: Tracker, text: string, command: string, now: number, usd: number): Tracker => {
  const key = normalize(text)
  const cmd = command.trim()
  const isSameCommand = cmd === t.failCommand

  if (key === t.key) {
    return {
      ...t,
      failCommand: cmd,
      repeats: t.repeats + 1,
      cmdFails: isSameCommand ? t.cmdFails + 1 : 1,
      phantoms: t.phantoms + (t.claimedFix ? 1 : 0),
      usd,
      claimedFix: false,
    }
  }

  // A new error on the same command is still the same fight, and edit-side
  // signals with no error yet belong to it too: keep their counters.
  const isSameFight = isSameCommand || t.repeats === 0
  const fresh = !isSameFight
    ? { ...EMPTY, since: now, usdAtStart: usd }
    : t.since
      ? t
      : { ...t, since: now, usdAtStart: usd }
  return {
    ...fresh,
    key,
    excerpt: excerptOf(text),
    failCommand: cmd,
    repeats: 1,
    cmdFails: isSameCommand ? t.cmdFails + 1 : 1,
    usd,
    claimedFix: false,
  }
}

/**
 * The failing command passes, or tests/build pass: the loop is over. Not while
 * an error was silenced: a test that passes because it was skipped proves nothing.
 */
export const onSuccess = (t: Tracker, command: string): Tracker =>
  !isIdle(t) && t.hacks === 0 && (command.trim() === t.failCommand || isHealthCheck(command)) ? EMPTY : t

/** A passing test/build is a state worth going back to, unless it was cheated. */
export const isGreen = (t: Tracker, command: string) => isHealthCheck(command) && t.hacks === 0

export const isIdle = (t: Tracker) => t.repeats === 0 && t.pingpongs === 0 && t.hacks === 0

/** Counts an edit-side signal, starting the clock when nothing was going on. */
export const bump = (t: Tracker, field: 'pingpongs' | 'hacks', now: number, usd: number): Tracker => ({
  ...t,
  [field]: t[field] + 1,
  since: t.since || now,
  usdAtStart: t.since ? t.usdAtStart : usd,
  usd,
})

const FIX_CLAIM = /\b(fixed|resolved|should (now )?work|works now|corrig[ée]|r[ée]gl[ée]|r[ée]solu)\b/i

export const claimsFix = (answer: string) => FIX_CLAIM.test(answer)

const JS = /\.[cm]?[jt]sx?$/i
const PY = /\.pyi?$/i

// [marker, label, files it can hide an error in]
const HACKS: [RegExp, string, RegExp][] = [
  [/@ts-ignore/g, '@ts-ignore', JS],
  [/@ts-nocheck/g, '@ts-nocheck', JS],
  [/@ts-expect-error/g, '@ts-expect-error', JS],
  [/eslint-disable/g, 'eslint-disable', JS],
  [/\bas any\b/g, 'as any', JS],
  [/\b(?:it|test|describe)\.skip\(/g, '.skip()', JS],
  [/\bx(?:it|describe)\(/g, 'xit()', JS],
  [/#\s*type:\s*ignore/g, '# type: ignore', PY],
  [/#\s*noqa/g, '# noqa', PY],
  [/@pytest\.mark\.skip/g, '@pytest.mark.skip', PY],
  [/@SuppressWarnings/g, '@SuppressWarnings', /\.(java|kt)$/i],
  [/#\[allow\(/g, '#[allow(...)]', /\.rs$/i],
  [/\/\/\s*nolint/g, '//nolint', /\.go$/i],
]

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0

/**
 * Error-silencing markers the edit adds to a file of a language they work in
 * (present more often after than before). Docs and other languages only talk about them.
 */
export const hacksAdded = (file: string, before: string, after: string) =>
  HACKS.filter(([re, , lang]) => lang.test(file) && count(after, re) > count(before, re)).map(([, label]) => label)

/** The edit writes back text it replaced earlier in the same file. */
export const isPingPong = (replacedBefore: readonly string[], written: string) =>
  written.trim().length > 0 && replacedBefore.includes(written)

const points = (t: Tracker, s: Settings) => {
  const errPts = t.repeats === 0 ? 0 : s.detectRepeat ? t.repeats : 1
  const cmdPts = s.detectCommand ? Math.max(0, t.cmdFails - 1) : 0

  return (
    Math.max(errPts, cmdPts) +
    (s.detectPhantom ? t.phantoms : 0) +
    (s.detectPingPong ? t.pingpongs : 0) +
    (s.detectHacks ? t.hacks : 0)
  )
}

export const levelOf = (t: Tracker, s: Settings): Level => {
  const p = points(t, s)

  return p >= s.redAt ? 'red' : p >= s.yellowAt ? 'yellow' : 'green'
}

/** What is going on, in words, strongest signal first. */
export const reasonsOf = (t: Tracker, s: Settings) =>
  [
    s.detectRepeat && t.repeats > 1 && `same error ${t.repeats}×`,
    s.detectCommand && t.cmdFails > t.repeats && t.cmdFails > 1 && `same command failed ${t.cmdFails}×`,
    s.detectPhantom && t.phantoms > 0 && `${t.phantoms} fake fix${t.phantoms > 1 ? 'es' : ''}`,
    s.detectPingPong && t.pingpongs > 0 && `${t.pingpongs} undone edit${t.pingpongs > 1 ? 's' : ''}`,
    s.detectHacks && t.hacks > 0 && `${t.hacks} silenced error${t.hacks > 1 ? 's' : ''}`,
  ].filter((r): r is string => typeof r === 'string')

export const burnedOf = (t: Tracker) => Math.max(0, t.usd - t.usdAtStart)

const HEALTH_CHECK = /\b(test|tests|build|tsc|lint|pytest|jest|vitest|mocha|cargo (test|build|check)|go (test|build|vet))\b/

export const isHealthCheck = (command: string) => HEALTH_CHECK.test(command)

export const nudgeFor = (t: Tracker, s: Settings) =>
  `[unstuck] You are going in circles (${reasonsOf(t, s).join(', ')}). Stop editing. Before any change:\n` +
  `1. List every fix you already tried.\n` +
  `2. List 3 hypotheses for the root cause that those fixes did not address.\n` +
  `3. Confirm the most likely one with logging or a minimal repro before touching the code.\n` +
  `Do not repeat a previous fix, and do not silence the error.`

export const hackNote = (labels: string[]) =>
  `[unstuck] This edit adds ${labels.join(', ')}, which hides the problem instead of fixing it. ` +
  `Unless the user asked for it, revert that part and fix the root cause.`

export const HANDOFF_PROMPT =
  'Write a handoff note for a fresh session that will continue this task with no memory of this conversation. ' +
  'Plain text, under 200 words, these sections: Goal. Current error (exact message). ' +
  'What was tried and failed (one line each). What NOT to retry. Suggested next step. ' +
  'Reply with the note only.'

export const opinionPrompt = (handoff: string) =>
  `Another agent is stuck on a bug and keeps failing. Give a second opinion with fresh eyes.\n\n${handoff}\n\n` +
  `Investigate the code read-only (do not edit anything). Find the root cause the previous attempts missed. ` +
  `Reply in under 200 words: the most likely root cause, the evidence (file:line), and the fix to try.`

export const diagnosePrompt = (t: Tracker) =>
  `Diagnostic mode: do not try another fix for "${t.excerpt}". ` +
  `Add logging or write a minimal repro that shows exactly where the assumption breaks, run it, and report what you found before changing any code.`

export const webPrompt = (t: Tracker) =>
  `Search the web for this exact error and summarize the known causes and fixes before trying anything else:\n${t.excerpt}`

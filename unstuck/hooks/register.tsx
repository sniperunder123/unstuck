import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Healthy, Level, Opinion, Settings, Tracker } from '../types'
import {
  bump,
  burnedOf,
  claimsFix,
  DEFAULTS,
  diagnosePrompt,
  EMPTY,
  hackNote,
  hacksAdded,
  HANDOFF_PROMPT,
  isGreen,
  isIdle,
  isPingPong,
  levelOf,
  nudgeFor,
  onError,
  onSuccess,
  opinionPrompt,
  reasonsOf,
  webPrompt,
} from './detect'

type $ = EngineInterface
type RenderEvent = Parameters<$['ui']['resolve']>[0]

const MENU = 'unstuck'
const SETTINGS = 'unstuck-settings'
// Kept in the mod's private store, never in the project: notes hold local paths and must not get committed.
const deadEndsKey = async ($: $) => `dead-ends:${await $.session.cwd()}`

const tracker = atom({ plugin: 'unstuck', key: 'tracker' } as const, EMPTY)
const settings = atom({ plugin: 'unstuck', key: 'settings' } as const, DEFAULTS)
const healthy = atom({ plugin: 'unstuck', key: 'healthy' } as const, null)
const dismissed = atom({ plugin: 'unstuck', key: 'dismissed' } as const, false)
const opinion = atom({ plugin: 'unstuck', key: 'opinion' } as const, null)

const SECTIONS: [string, [keyof Settings, string][]][] = [
  [
    'Detect',
    [
      ['detectRepeat', 'The same error coming back'],
      ['detectCommand', 'The same command failing (even with new errors)'],
      ['detectPhantom', 'Claude saying "fixed" when it is not'],
      ['detectPingPong', 'Claude undoing its own edits'],
      ['detectHacks', 'Claude silencing errors (@ts-ignore, .skip(), ...)'],
    ],
  ],
  [
    'Act',
    [
      ['nudge', 'On red, tell Claude to stop and list hypotheses'],
      ['blockHacks', 'Block edits that silence errors (instead of flagging them)'],
      ['deadEnds', 'Remember dead ends for this project across sessions'],
    ],
  ],
  [
    'Notify',
    [
      ['toast', 'Pop-up notifications'],
      ['band', 'Red band above the prompt'],
      ['status', 'Status line while looping'],
    ],
  ],
]

// ponytail: per-file replaced texts live in the module, a hot reload forgets them
const replaced = new Map<string, string[]>()
let deadEnds = ''

const usd = async ($: $) => {
  try {
    return (await $.session.usage()).cost?.usd ?? 0
  } catch {
    return 0
  }
}

const money = (n: number) => (n >= 0.01 ? ` · ≈$${n.toFixed(2)} burned` : '')

const toast = async ($: $, text: string) => {
  if ((await read($, settings)).toast) $.ui.toast(text)
}

const showStatus = ($: $, t: Tracker, s: Settings) => {
  const level = levelOf(t, s)
  const why = reasonsOf(t, s)[0] ?? 'going in circles'

  $.ui.status(
    !s.status || level === 'green'
      ? undefined
      : level === 'red'
        ? `🔴 Claude is stuck · ${why} · /unstuck`
        : `🟡 Claude may be looping · ${why}`,
  )
}

const setTracker = async ($: $, next: Tracker, quiet = false) => {
  const s = await read($, settings)
  const before = levelOf(await read($, tracker), s)
  const after = levelOf(next, s)
  await update($, tracker, () => next)
  showStatus($, next, s)
  if (quiet || after === before) return

  if (after === 'red') {
    await update($, dismissed, () => false)
    await toast($, `🔴 Claude is stuck: ${reasonsOf(next, s).join(', ')}.\nWays out: ${s.band ? 'above the prompt' : '/unstuck'}`)
  } else if (after === 'yellow' && before === 'green') {
    await toast($, `🟡 Claude may be going in circles: ${reasonsOf(next, s).join(', ')}.`)
  } else if (after === 'green') {
    await toast($, '✅ Loop broken, back on track.')
  }

  if (after !== 'green') {
    const { context } = await $.session.usage().catch(() => ({ context: { percent: 0 } }))
    if ((context.percent ?? 0) >= 80) {
      await toast($, `🧠 Context is ${Math.round(context.percent ?? 0)}% full: a clean restart will help more than another try.`)
    }
  }
}

const setSettings = async ($: $, patch: Partial<Settings>) => {
  const next = { ...(await read($, settings)), ...patch }
  next.yellowAt = Math.max(2, next.yellowAt)
  next.redAt = Math.max(next.yellowAt, next.redAt)
  await update($, settings, () => next)
  await $.store.set('settings', next)
  showStatus($, await read($, tracker), next)
}

const git = ($: $, ...args: string[]) => $.process.run(['git', ...args])

/** Snapshot the working tree without touching it: a stash commit, or HEAD when clean. */
const snapshot = async ($: $) => {
  try {
    const stash = (await git($, 'stash', 'create')).stdout.trim()
    const sha = stash || (await git($, 'rev-parse', 'HEAD')).stdout.trim()
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null
  } catch {
    return null // ponytail: no git, no revert
  }
}

const handoff = async ($: $) => {
  const note = await $.model.fork({ prompt: HANDOFF_PROMPT })
  if (!note.isAnswered) {
    $.ui.toast(`unstuck: could not summarize the session (${note.reason}).`)
    return null
  }

  return note.text.trim()
}

const rememberDeadEnd = async ($: $, note: string) => {
  if (!(await read($, settings)).deadEnds) return

  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  // ponytail: keep the last 5 entries, enough to steer without bloating the prompt
  const entries = [...deadEnds.split(/\n(?=## )/).filter(x => x.startsWith('## ')), `## ${date}\n\n${note}\n`].slice(-5)
  deadEnds = entries.join('\n')
  await $.store.set(await deadEndsKey($), deadEnds).catch(() => undefined)
}

const revert = async ($: $) => {
  const target = await read($, healthy)
  if (target === null) {
    $.ui.toast('unstuck: no healthy state yet (needs a passing test or build in a git repo).')
    return
  }

  const backup = await snapshot($)
  // ponytail: tracked files only; files created since stay, untracked files are never touched
  const { exitCode, stderr } = await git($, 'restore', `--source=${target.sha}`, '--staged', '--worktree', '--', '.')
  if (exitCode !== 0) {
    $.ui.toast(`unstuck: revert failed: ${stderr.trim().slice(0, 200)}`)
    return
  }

  const t = await read($, tracker)
  await $.session.append({
    message: {
      type: 'user',
      content: [
        {
          type: 'text',
          text:
            `[unstuck] The user reverted the working tree to the last state where tests/build passed. ` +
            `Your previous fixes for "${t.excerpt}" are gone and did not work: do not repeat them.`,
        },
      ],
    },
  })
  await setTracker($, EMPTY, true)
  $.ui.toast(backup ? `⏪ Reverted. Undo with:\ngit restore --source=${backup} --worktree -- .` : '⏪ Reverted.')
}

const restart = async ($: $) => {
  $.ui.toast('🧹 Writing a handoff note, then starting fresh…')
  const note = await handoff($)
  if (note === null) return

  await rememberDeadEnd($, note)
  await setTracker($, EMPTY, true)
  await $.command.run({ command: 'clear', args: '' })
  await $.prompt.fill({
    text: `Fresh start on a task the previous session got stuck on.\n\n${note}\n\nList your hypotheses before editing anything.`,
  })
  $.ui.toast('🧹 Fresh session. Review the note in the prompt, then press Enter.')
}

const secondOpinion = async ($: $) => {
  const current = await read($, opinion)
  if (current?.status === 'running') {
    $.ui.toast('🔎 A second opinion is already on its way.')
    return
  }

  $.ui.toast('🔎 Asking a fresh agent for a second opinion…')
  const note = await handoff($)
  if (note === null) return

  await rememberDeadEnd($, note)
  const prompt = opinionPrompt(note)
  const description = 'unstuck: second opinion'
  let spawned = await $.agent.spawn({ prompt, description, subagentType: 'Explore' })
  if (spawned.deny !== undefined) spawned = await $.agent.spawn({ prompt, description })
  if (spawned.deny !== undefined || spawned.agentId === undefined) {
    $.ui.toast(`unstuck: could not start an agent (${spawned.deny ?? 'no id'}).`)
    return
  }

  const agentId = spawned.agentId
  await update($, opinion, () => ({ agentId, status: 'running' as const, text: '' }))
}

const useOpinion = async ($: $) => {
  const op = await read($, opinion)
  if (op?.status !== 'done') return

  await $.prompt.fill({
    text: `A fresh agent investigated the bug you are stuck on. Its second opinion:\n\n${op.text}\n\nCheck it against the code, then fix the root cause it points to.`,
  })
  await update($, opinion, () => null)
}

const fill = ($: $, text: string) => $.prompt.fill({ text })

type View = { t: Tracker; green: Healthy | null; op: Opinion | null }

const viewOf = async ($: $): Promise<View> => ({
  t: await read($, tracker),
  green: await read($, healthy),
  op: await read($, opinion),
})

/** Synchronous on purpose: JSX built after an await loses the element factory. */
const Actions = ($: $, e: RenderEvent, { t, green, op }: View, isFull: boolean) => {
  const { Box, Button } = $.ui.resolve(e)

  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {op?.status === 'done' && (
        <Button key="use-opinion" hotkey="u" variant="primary" label="💡 Use 2nd opinion" onPress={() => useOpinion($)} />
      )}
      {green !== null && (
        <Button key="revert" hotkey="r" variant={op?.status === 'done' ? 'secondary' : 'primary'} label="⏪ Revert to last green" onPress={() => revert($)} />
      )}
      <Button key="restart" hotkey="c" label="🧹 Clean restart" onPress={() => restart($)} />
      {op?.status !== 'done' && (
        <Button
          key="opinion"
          hotkey="o"
          label={op?.status === 'running' ? '🔎 Asking…' : '🔎 2nd opinion'}
          onPress={() => secondOpinion($)}
        />
      )}
      {isFull && <Button key="diagnose" hotkey="d" label="🔬 Diagnose first" onPress={() => fill($, diagnosePrompt(t))} />}
      {isFull && <Button key="web" hotkey="w" label="🌐 Search the error" onPress={() => fill($, webPrompt(t))} />}
      <Button key="reset" hotkey="x" dimColor label="Not stuck" onPress={() => setTracker($, EMPTY, true)} />
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('settings')) as Partial<Settings> | undefined
    const s = { ...DEFAULTS, ...saved }
    await update($, settings, () => s)
    // A tracker from an older version lacks today's counters: start clean.
    await update($, tracker, t => (t && Object.keys(EMPTY).every(k => k in t) ? t : EMPTY))
    showStatus($, await read($, tracker), s)
    deadEnds = String((await $.store.get(await deadEndsKey($))) ?? '')
    await $.command.register({
      name: 'unstuck',
      description: 'Ways out when Claude is going in circles',
      argumentHint: '[settings|reset]',
    })

    return next(e)
  })

  on('command.run', { command: 'unstuck' }, async ($, e) => {
    const arg = e.args.trim()

    if (arg === 'settings') {
      await $.ui.open({ id: SETTINGS, title: 'unstuck · settings', focus: true })
      return { text: 'unstuck settings opened.' }
    }
    if (arg === 'reset') {
      await setTracker($, EMPTY, true)
      return { text: 'unstuck: tracker reset.' }
    }

    await $.ui.open({ id: MENU, title: 'unstuck', focus: true })
    return { text: 'unstuck menu opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!deadEnds.trim() || !(await read($, settings)).deadEnds) return composed

    return {
      sections: [
        ...composed.sections,
        {
          id: 'unstuck:dead-ends',
          scope: 'session' as const,
          text: `# Dead ends in this project\nEarlier sessions got stuck here. Do not retry what these notes say failed.\n\n${deadEnds}`,
        },
      ],
    }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || e.run_in_background || e.agentId !== undefined) return ran

    const before = await read($, tracker)

    if (ran.isError) {
      const t = onError(before, ran.text ?? '', e.command, await $.clock.now(), await usd($))
      const s = await read($, settings)
      const shouldNudge = s.nudge && levelOf(t, s) === 'red' && !t.nudged
      await setTracker($, shouldNudge ? { ...t, nudged: true } : t)

      return shouldNudge ? { ...ran, context: [...(ran.context ?? []), nudgeFor(t, s)] } : ran
    }

    const t = onSuccess(before, e.command)
    if (t !== before) await setTracker($, t)

    if (isGreen(before, e.command)) {
      const sha = await snapshot($)
      if (sha) await update($, healthy, () => ({ sha, at: Date.now() }))
    }

    return ran
  }).catch(($, e, next) => next(e)) // never let unstuck break a Bash call

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const s = await read($, settings)
    const file = e.file_path
    const isEdit = e.tool === 'Edit'
    const written = isEdit ? e.new_string : e.content
    const old = isEdit ? e.old_string : await $.fs.read(file).catch(() => '')
    const hacks = s.detectHacks ? hacksAdded(file, old, written) : []

    if (hacks.length > 0 && s.blockHacks) {
      await toast($, `🙈 Blocked: Claude tried to silence an error with ${hacks.join(', ')}.`)
      return { deny: hackNote(hacks) }
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    const history = replaced.get(file) ?? []
    const isUndo = s.detectPingPong && isPingPong(history, written)
    replaced.set(file, [...history, old].slice(-30))

    let t = await read($, tracker)
    const now = await $.clock.now()
    const name = file.split(/[\\/]/).pop()

    if (isUndo) {
      t = bump(t, 'pingpongs', now, await usd($))
      await toast($, `↩️ Claude just undid one of its own earlier edits in ${name}.`)
    }
    if (hacks.length > 0) {
      t = bump(t, 'hacks', now, await usd($))
      await toast($, `🙈 Claude silenced an error in ${name}: ${hacks.join(', ')}.`)
    }
    if (isUndo || hacks.length > 0) await setTracker($, t)

    return hacks.length > 0 ? { ...ran, context: [...(ran.context ?? []), hackNote(hacks)] } : ran
  }).catch(($, e, next) => next(e)) // fail open: a broken detector never blocks an edit

  on('turn.complete', async ($, e, next) => {
    const op = await read($, opinion)

    if (e.agentId !== undefined && op?.agentId === e.agentId) {
      await update($, opinion, () => ({ ...op, status: 'done' as const, text: e.answer.trim() }))
      await update($, dismissed, () => false)
      $.ui.toast('💡 Second opinion ready. Press "Use 2nd opinion" above the prompt, or /unstuck.')
    } else if (e.agentId === undefined && claimsFix(e.answer)) {
      const t = await read($, tracker)
      if (!isIdle(t)) await update($, tracker, x => ({ ...x, claimedFix: true }))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const t = await read($, tracker)
    const s = await read($, settings)
    const isHidden = await read($, dismissed)
    const op = await read($, opinion)
    const isRed = levelOf(t, s) === 'red'
    const hasOpinion = op?.status === 'done'

    if (e.props.hasSurvey || !s.band || isHidden || !(isRed || hasOpinion)) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const minutes = Math.max(1, Math.round(((await $.clock.now()) - t.since) / 60000))
    const view = await viewOf($)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={isRed ? 'error' : 'suggestion'} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text color={isRed ? 'error' : 'suggestion'} bold>
            {isRed
              ? `🔴 Claude is stuck · ${reasonsOf(t, s).join(' · ')} · ${minutes} min${money(burnedOf(t))}`
              : '💡 A fresh agent has a second opinion on the bug'}
          </Text>
          <Button key="hide" plain dimColor label="hide" onPress={() => update($, dismissed, () => true)} />
        </Box>
        {isRed && t.excerpt !== '' && (
          <Text dimColor wrap="truncate-end">
            {t.excerpt}
          </Text>
        )}
        {Actions($, e, view, false)}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: MENU }, async ($, e) => {
    const t = await read($, tracker)
    const s = await read($, settings)
    const green = await read($, healthy)
    const op = await read($, opinion)
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const level: Level = levelOf(t, s)
    const reasons = reasonsOf(t, s)
    const headline = { green: '🟢 All good', yellow: '🟡 Claude may be looping', red: '🔴 Claude is stuck' }[level]
    const color = { green: 'success', yellow: 'warning', red: 'error' }[level]
    const view = await viewOf($)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold color={color}>
            {headline}
          </Text>
          {reasons.length > 0 && <Text>{reasons.join(' · ') + money(burnedOf(t))}</Text>}
          {t.excerpt !== '' && (
            <Text dimColor wrap="truncate-end">
              {t.excerpt}
            </Text>
          )}
        </Box>
        <Text dimColor>
          {green ? `⏪ Last green state: ${green.sha.slice(0, 7)}` : '⏪ No green state yet (needs a passing test or build in git).'}
        </Text>
        {op?.status === 'running' && <Text color="suggestion">🔎 A fresh agent is investigating…</Text>}
        {op?.status === 'done' && (
          <Box flexDirection="column">
            <Text bold color="suggestion">
              💡 Second opinion
            </Text>
            <Markdown key="opinion-text" text={op.text} />
          </Box>
        )}
        {Actions($, e, view, true)}
        <Button key="settings" hotkey="s" plain dimColor label="⚙ Settings" onPress={() => $.ui.open({ id: SETTINGS, title: 'unstuck · settings', focus: true })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    const s = await read($, settings)
    const { Box, Text, Button } = $.ui.resolve(e)

    const Stepper = (key: 'yellowAt' | 'redAt', label: string) => (
      <Box flexDirection="row" gap={1}>
        <Button key={`${key}-down`} label="-" onPress={() => setSettings($, { [key]: s[key] - 1 })} />
        <Text bold>{s[key]}</Text>
        <Button key={`${key}-up`} label="+" onPress={() => setSettings($, { [key]: s[key] + 1 })} />
        <Text>{label}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        {SECTIONS.map(([title, rows]) => (
          <Box flexDirection="column">
            <Text bold>{title}</Text>
            {rows.map(([key, label]) => (
              <Button
                key={key}
                plain
                dimColor={!s[key]}
                label={`${s[key] ? '◉' : '○'} ${label}`}
                onPress={() => setSettings($, { [key]: !s[key] })}
              />
            ))}
          </Box>
        ))}
        <Box flexDirection="column">
          <Text bold>Sensitivity</Text>
          {Stepper('yellowAt', 'signals before 🟡')}
          {Stepper('redAt', 'signals before 🔴')}
          <Text dimColor>One signal = one repeat, fake fix, undone edit or silenced error.</Text>
        </Box>
      </Box>
    )
  })
}

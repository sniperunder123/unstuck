# unstuck — Roadmap

> Detects when Claude Code is going in circles, tells you clearly, and gets you out.
> A Claude Code mod for vibecoders.

## v0.1 — MVP

**Detect**
- [x] Same error ×3: hash of normalized error output (paths, line numbers, timestamps stripped)
- [x] Phantom fix: Claude says "fixed" but the next run fails with the same error

**Show**
- [x] Status line, only while looping: 🟡 / 🔴 + the reason
- [x] Colored band above the prompt when red: error, attempts, time lost
- [x] Toast on yellow

**Intervene**
- [x] Inject a "Stop. List your hypotheses before editing anything" message to Claude

**Escape menu** (buttons in the band + `/unstuck`)
- [x] Revert to last healthy state (last time tests/build passed)
- [x] Clean restart: summarize what was tried → `/clear` → re-inject summary

**Settings**
- [x] `/unstuck settings` opens a settings pane
  - Toggle each detector on/off
  - Toggle each intervention on/off
  - Notification style: band / toast / status line
  - Thresholds (how many repeats before yellow/red)
  - Saved across sessions

## v0.2

**Detect**
- [x] File ping-pong: same file edited → reverted → re-edited
- [x] Never-passing test: same test fails after 3+ fix attempts
- [x] Workaround hacks: `@ts-ignore`, `any`, `eslint-disable`, `.skip()` appearing
- [ ] Spinning: many tool calls, no progress (no new passing test, same error)
- [ ] Scope drift: touched-file count explodes vs. a small initial request
- [x] Context saturation: >80% context used while looping (toast suggests a clean restart)

**Intervene**
- [x] Anti-cheat: block or flag workaround hacks
- [ ] Sound alert on red (blocked: the mod audio API plays nothing on Windows)
- [x] Money burned in the loop, shown in the band

**Escape menu**
- [x] Second opinion: subagent with a fresh context (or another model), given only the bug + failed attempts
- [x] Diagnostic mode: add logs and a repro instead of guessing fixes
- [ ] Rephrase helper: help the user clarify the request
- [x] Web search on the exact error

## v0.3

- [x] Dead-ends log per project (last 5), kept in the mod's private store and injected into the system prompt
- [ ] Stats: time and tokens lost in loops per session (shareable)
- [ ] Attempts history pane
- [ ] Integrate with a checkpoint timeline mod (auto git snapshot before each edit)

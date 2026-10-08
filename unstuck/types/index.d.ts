export type UnstuckSettings = {
  detectRepeat: boolean
  detectCommand: boolean
  detectPhantom: boolean
  detectPingPong: boolean
  detectHacks: boolean
  nudge: boolean
  blockHacks: boolean
  deadEnds: boolean
  band: boolean
  toast: boolean
  status: boolean
  /** Points before yellow. */
  yellowAt: number
  /** Points before red. */
  redAt: number
}

export type Tracker = {
  /** Normalized error, the identity of "the same error". */
  key: string
  /** First error line as Claude saw it, for display. */
  excerpt: string
  /** Command that keeps failing. */
  failCommand: string
  /** Same error in a row. */
  repeats: number
  /** Same command failing in a row, whatever the error. */
  cmdFails: number
  /** Claude said "fixed" and the same error came back. */
  phantoms: number
  /** Claude undid one of its own earlier edits. */
  pingpongs: number
  /** Claude silenced an error (ts-ignore, .skip(), ...). */
  hacks: number
  since: number
  usdAtStart: number
  usd: number
  claimedFix: boolean
  nudged: boolean
}

export type Healthy = { sha: string; at: number }

export type Opinion = { agentId: string; status: 'running' | 'done'; text: string }

export type Level = 'green' | 'yellow' | 'red'

declare module 'claude-code' {
  interface PluginState {
    unstuck: {
      tracker: Tracker
      settings: UnstuckSettings
      healthy: Healthy | null
      dismissed: boolean
      opinion: Opinion | null
    }
  }
}

/** Short alias for the module; the contract uses UnstuckSettings (claude-code has its own Settings). */
export type Settings = UnstuckSettings

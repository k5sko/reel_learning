// Central config + capability flags. The whole memory backend runs in "mock"
// mode out of the box (no keys, no installs) and lights up real sponsor
// integrations only when the matching env vars are present.
//
//   REDIS_URL            -> persistence + vector recall via Redis (vs in-memory)
//   ANTHROPIC_API_KEY    -> Claude does extraction + connection reasoning
//   ARIZE_SPACE_ID +
//   ARIZE_API_KEY        -> trace/evaluate the Claude reasoning calls
//
// Mock fallbacks mirror the real shapes so the demo is identical either way.

import { readFileSync } from 'node:fs'

// Load keys from a dotenv file before reading them. Prefer .env; fall back to
// .env.example so a freshly-cloned demo still picks up whatever is there.
//
// We parse + assign ourselves (instead of process.loadEnvFile) on purpose: some
// environments export an EMPTY ANTHROPIC_API_KEY, and loadEnvFile/--env-file
// won't override an already-present var — so the empty one would win. Here the
// file's non-empty value always takes precedence.
function loadEnv() {
  for (const file of ['.env', '.env.example']) {
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // file absent — try the next
    }
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      // File value wins over an empty/unset env var; respect a real pre-set one.
      if (val && !process.env[key]) process.env[key] = val
    }
    break
  }
}
loadEnv()

const env = process.env

export const config = {
  redisUrl: env.REDIS_URL || '',
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-4-8',
  arize: {
    spaceId: env.ARIZE_SPACE_ID || '',
    apiKey: env.ARIZE_API_KEY || '',
    project: env.ARIZE_PROJECT || 'reel-learning-memory',
  },
  embedDim: 96,
}

export const flags = {
  get redis() {
    return Boolean(config.redisUrl)
  },
  get claude() {
    return Boolean(config.anthropicKey)
  },
  get arize() {
    return Boolean(config.arize.spaceId && config.arize.apiKey)
  },
}

export function modeBanner() {
  const on = (b) => (b ? 'live' : 'mock')
  return `memory backend · redis:${on(flags.redis)} claude:${on(flags.claude)} arize:${on(
    flags.arize,
  )}`
}

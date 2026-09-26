import type { BonusGrant } from '../bonuses/contracts.js'

export type OriginalGame = 'forest' | 'caches' | 'chest'

export type Finding = 'coin' | 'crystal' | 'key' | 'bankrupt' | 'star'

export type ForestSpin = { kind: 'outer' | 'inner' | 'risk'; angle: number }

export interface ForestData {
  phase: 'coin' | 'key' | 'choose' | 'settled'
  finding: Finding
  mode: 'outer' | 'inner' | 'risk'
  keyMultiplier: number
  offerMinor: string
  crystalAwardMinor: string
  target: number
  lastSpin: ForestSpin | null
  message: string
}

export interface CacheChoice {
  index: number
  result: 'treasure' | 'empty'
  rank: number
  payoutMinor: string
}

export interface CachesData {
  phase: 'choose' | 'offer' | 'won' | 'lost'
  found: number
  current: number
  opened: CacheChoice[]
  /** Full board only after settlement; opened remains the actual player choices. */
  revealed?: { index: number; result: CacheChoice['result'] }[]
  offerMinor: string
  nextPayoutMinor: string
  nextChance: number
}

export interface ChestData {
  /** Internal rational value; public responses expose only rounded payouts. */
  valueNumerator?: string
  valueDenominator?: string
  /** Historical marker only: retired demo rounds cannot credit the wallet. */
  freePush?: boolean
  nextGoldenPayoutMinor?: string
  beforeKeyMinor?: string
  lastKey?: 'silver' | 'gold' | null
  boostNumerator?: number
  boostDenominator?: number
  phase: 'offer' | 'won' | 'lost'
  stage: number
  items: ('acorn' | 'dew' | 'flower')[]
  offerMinor: string
  nextPayoutMinor: string
  nextChanceNumerator: number
  nextChanceDenominator: number
}

export interface OriginalRound {
  roundId: string
  game: OriginalGame
  stakeMinor: string
  version: number
  active: boolean
  rulesVersion: string
  payoutMinor: string
  data: ForestData | CachesData | ChestData
}

export interface OriginalState {
  bonusGrants?: BonusGrant[] // Optional for stored responses written before bonus synchronization.
  balanceMinor: string
  walletVersion: number
  round: OriginalRound | null
  history: OriginalRound[]
  crystals: number
  crystalBonusMinor: string
}

export type PoolId = 'mini' | 'mega'

export interface JackpotPool {
  id: PoolId
  amountMinor: string
  endsAt: string
  contributionBasisPoints: number
}

export interface JackpotDraw {
  drawId: string
  pool: PoolId
  amountMinor: string
  endsAt: string
  version: number
  cards: { index: number; symbol: 'nebi' | 'crystal' | 'coin' }[]
  result: 'pending' | 'won' | 'lost' | 'paid'
}

export interface NetworkState {
  balanceMinor: string
  walletVersion: number
  serverTime: string
  pools: JackpotPool[]
  pending: JackpotDraw[]
  hasMore: boolean
  draw: JackpotDraw | null
}

export type OriginalsEvent =
  | 'chest.start'
  | 'chest.open'
  | 'chest.cashout'
  | 'chest.sync'
  | 'chest.commandStatus'
  | 'forest.start'
  | 'forest.open'
  | 'forest.charge'
  | 'forest.spin'
  | 'forest.risk'
  | 'forest.cashout'
  | 'forest.sync'
  | 'forest.commandStatus'
  | 'caches.start'
  | 'caches.reveal'
  | 'caches.cashout'
  | 'caches.sync'
  | 'caches.commandStatus'
  | 'jackpots.sync'
  | 'jackpots.reveal'
  | 'jackpots.claim'
  | 'jackpots.commandStatus'

export type OriginalsReply =
  | {
      ok: true
      requestId: string
      data: OriginalState | NetworkState | { response: OriginalsReply | null }
    }
  | {
      ok: false
      requestId: string | null
      error: { code: string; message: string; retryable: boolean }
    }

import type { BonusGrant } from '../bonuses/contracts.js'

export type DiceStatus = 'ACTIVE' | 'LOST' | 'WON' | 'CASHED_OUT'

export type DiceCell = { index: number; result: 'safe' | 'mine' }

export interface DiceRound {
  roundId: string
  version: number
  status: DiceStatus
  stakeMinor: string
  mines: number
  rulesVersion: string
  openedCells: DiceCell[]
  multiplierHundredths: number
  nextMultiplierHundredths: number | null
  cashoutMinor: string
  settledPayoutMinor: string
}

export interface DiceState {
  bonusGrants?: BonusGrant[] // Optional for stored responses written before bonus synchronization.
  balanceMinor: string
  walletVersion: number
  round: DiceRound | null
  history: DiceRound[]
}

export type DiceReply =
  | {
      ok: true
      requestId: string
      data: DiceState | { response: DiceReply | null }
    }
  | {
      ok: false
      requestId: string | null
      error: { code: string; message: string; retryable: boolean }
    }

export type DiceEvent =
  'dice.start' | 'dice.reveal' | 'dice.cashout' | 'dice.sync' | 'dice.commandStatus'

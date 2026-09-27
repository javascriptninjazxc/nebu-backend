import type { DiceStatus } from './contracts.js'

export type Round = {
  id: string
  user_id: string
  stake: string
  mines: number
  mask: number
  status: DiceStatus
  version: number
  rules_version: string
  payout: string
}

export type Wallet = { balance: string; version: number }

export type Move = { cell: number; result: 'safe' | 'mine' }

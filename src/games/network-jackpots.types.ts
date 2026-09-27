import type { PoolId } from './contracts.js'

export type Period = {
  id: string
  pool: PoolId
  amount: string
  total_weight: string
  winner_id: string | null
  paid: boolean
  ends_at: Date
  status: 'OPEN' | 'DRAWN' | 'EMPTY'
}

export type Participation = Period & { opened: number; version: number }

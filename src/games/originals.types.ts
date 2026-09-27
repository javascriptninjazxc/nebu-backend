import type { CachesData, ChestData, ForestData, OriginalGame } from './contracts.js'

export type Round = {
  id: string
  user_id: string
  game: OriginalGame
  stake: string
  active: boolean
  version: number
  rules_version: string
  state: ForestData | CachesData | ChestData
  secret: { mask?: number }
  payout: string
}

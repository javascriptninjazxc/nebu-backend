export type Settings = {
  wager_multiplier: string
  round_days: number
  weekly_deposit_minor: string
}

export type Draw = {
  id: string
  user_id: string | null
  prize_index: number
  game: string
  rounds: number
  stake: string
  wager_multiplier: string
  round_days: number
  claimed_at: Date | null
  mode: string
}

export type Grant = {
  id: string
  game: string
  stake: string
  remaining: number
  expires_at: Date
  wager_multiplier: string
  winnings: string
  balance: string
  released_amount: string
  required: string
  wagered: string
  released: boolean
}

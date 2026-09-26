export type ProfileGame = 'dice' | 'forest' | 'caches' | 'chest'

export interface ProfileRound {
  id: string
  game: ProfileGame
  stakeMinor: string
  payoutMinor: string
  createdAt: string
}

export interface ProfileEntry {
  id: string
  reason: 'GRANT' | 'STAKE' | 'PAYOUT' | 'BONUS_RELEASE'
  deltaMinor: string
  balanceAfterMinor: string
  createdAt: string
}

export interface PlayerProfile {
  user: {
    id: string
    login: string
    displayName: string
    avatar: string
    createdAt: string
  }
  balanceMinor: string
  stats: { rounds: number; stakeMinor: string; payoutMinor: string }
  history: ProfileRound[]
  historyTotal: number
  entries: ProfileEntry[]
  entriesTotal: number
  sessions: number
  telegramLinked: boolean
}

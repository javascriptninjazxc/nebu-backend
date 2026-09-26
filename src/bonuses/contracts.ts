export interface BonusGrant {
  id: string
  game: string
  stakeMinor: string
  remaining: number
  expiresAt: string
  winningsMinor: string
  balanceMinor: string
  releasedMinor: string
  requiredMinor: string
  wageredMinor: string
  wagerMultiplier: string
  released: boolean
}

export interface BonusLockAccountParams {
  user: string
}

export interface BonusLockGuestParams {
  guest: string
}

export type BonusWeekWindowRow = { period: string; next: string }

export type BonusWeeklyDepositsRow = { total: string }

export interface BonusWeeklyDepositsParams {
  user: string
}

export interface BonusCreateGrantParams {
  id: string
  user: string
  game: string
  stake: string
  rounds: number
  days: number
  multiplier: string
}

export interface BonusDebitGrantParams {
  id: string
  stake: string
}

export interface BonusCreditBonusBetParams {
  round: string
  amount: string
}

export interface BonusCreditGrantBalanceParams {
  id: string
  amount: string
}

export interface BonusCreditBonusRoundParams {
  round: string
  amount: string
}

export interface BonusCreditGrantAndRequirementParams {
  id: string
  amount: string
}

export interface BonusApplyCappedTurnoverParams {
  id: string
  stake: string
}

export interface BonusClaimTurnoverParams {
  round: string
  user: string
  stake: string
}

export interface BonusApplyTurnoverParams {
  id: string
  add: string
}

export interface BonusLockReleasableGrantsParams {
  user: string
}

export type BonusCreditWalletRow = { balance: string }

export interface BonusCreditWalletParams {
  user: string
  amount: string
}

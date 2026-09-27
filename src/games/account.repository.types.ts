export type GameAccountIncrementActionLimitRow = { count: number }

export interface GameAccountIncrementActionLimitParams {
  key: string
  seconds: number
}

export type GameAccountConsumeTicketRow = { session_hash: string }

export interface GameAccountConsumeTicketParams {
  hash: string
}

export interface GameAccountLockAccountParams {
  user: string
}

export interface GameAccountCreditWalletParams {
  user: string
  delta: string
}

export type NetworkJackpotsClockRow = { now: Date }

export type NetworkJackpotsEnsurePeriodRow = { id: string }

export interface NetworkJackpotsEnsurePeriodParams {
  id: string
  pool: 'mini' | 'mega'
  start: Date
  end: Date
}

export interface NetworkJackpotsContributeToPeriodParams {
  id: string
  amount: string
  stake: string
}

export interface NetworkJackpotsContributeToParticipantParams {
  period: string
  user: string
  stake: string
}

export type NetworkJackpotsTryLockScheduleRow = { locked: boolean }

export interface NetworkJackpotsFindPendingDrawsParams {
  user: string
}

export interface NetworkJackpotsFindDrawParams {
  user: string
  id: string
}

export interface NetworkJackpotsLockParticipantPeriodParams {
  id: string
  user: string
}

export interface NetworkJackpotsRevealCardParams {
  id: string
  user: string
  bit: number
}

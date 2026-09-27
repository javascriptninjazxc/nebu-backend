import { AuthLimitsModel } from '../auth/auth-limits.model.js'
import { PlayerProfilesModel } from '../auth/player-profiles.model.js'
import { BonusBetsModel } from '../bonuses/bonus-bets.model.js'
import { BonusDrawsModel } from '../bonuses/bonus-draws.model.js'
import { BonusGrantsModel } from '../bonuses/bonus-grants.model.js'
import { BonusRoundsModel } from '../bonuses/bonus-rounds.model.js'
import { BonusSettingsModel } from '../bonuses/bonus-settings.model.js'
import { BonusTurnoverModel } from '../bonuses/bonus-turnover.model.js'
import { ConfirmedDepositsModel } from '../bonuses/confirmed-deposits.model.js'
import { DiceCommandsModel } from '../dice/dice-commands.model.js'
import { DiceConnectionsModel } from '../dice/dice-connections.model.js'
import { DiceLimitsModel } from '../dice/dice-limits.model.js'
import { DiceMovesModel } from '../dice/dice-moves.model.js'
import { DiceRoundsModel } from '../dice/dice-rounds.model.js'
import { DiceTicketsModel } from '../dice/dice-tickets.model.js'
import { JackpotContributionsModel } from '../games/jackpot-contributions.model.js'
import { JackpotOutboxModel } from '../games/jackpot-outbox.model.js'
import { JackpotParticipantsModel } from '../games/jackpot-participants.model.js'
import { JackpotPeriodsModel } from '../games/jackpot-periods.model.js'
import { OriginalCommandsModel } from '../games/original-commands.model.js'
import { OriginalProgressModel } from '../games/original-progress.model.js'
import { OriginalRoundsModel } from '../games/original-rounds.model.js'

export const databaseModels = [
  DiceRoundsModel,
  DiceMovesModel,
  DiceCommandsModel,
  DiceTicketsModel,
  DiceConnectionsModel,
  DiceLimitsModel,
  OriginalRoundsModel,
  OriginalProgressModel,
  OriginalCommandsModel,
  JackpotPeriodsModel,
  JackpotParticipantsModel,
  JackpotContributionsModel,
  JackpotOutboxModel,
  PlayerProfilesModel,
  BonusSettingsModel,
  BonusDrawsModel,
  BonusGrantsModel,
  BonusRoundsModel,
  BonusTurnoverModel,
  ConfirmedDepositsModel,
  BonusBetsModel,
  AuthLimitsModel,
]

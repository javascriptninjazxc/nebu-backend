import { Column, DataType, Model, Table } from 'sequelize-typescript'

interface WalletAttributes {
  userId: string
  balance: string
  version: number
}

@Table({ tableName: 'dice_wallets', timestamps: false })
export class DiceWallet extends Model<WalletAttributes, WalletAttributes> {
  @Column({ field: 'user_id', type: DataType.UUID, primaryKey: true })
  declare userId: string
  @Column({ type: DataType.BIGINT, allowNull: false }) declare balance: string
  @Column({ type: DataType.INTEGER, allowNull: false }) declare version: number
}
interface EntryAttributes {
  id: string
  userId: string
  roundId: string | null
  gameRoundId?: string | null
  jackpotPeriodId?: string | null
  reason: 'GRANT' | 'STAKE' | 'PAYOUT' | 'BONUS_RELEASE'
  delta: string
  balanceAfter: string
}

@Table({ tableName: 'dice_entries', timestamps: false })
export class DiceEntry extends Model<EntryAttributes, EntryAttributes> {
  @Column({ type: DataType.UUID, primaryKey: true }) declare id: string
  @Column({ field: 'user_id', type: DataType.UUID, allowNull: false })
  declare userId: string
  @Column({ field: 'round_id', type: DataType.UUID }) declare roundId: string | null
  @Column({ field: 'game_round_id', type: DataType.UUID }) declare gameRoundId: string | null
  @Column({ field: 'jackpot_period_id', type: DataType.UUID })
  declare jackpotPeriodId: string | null
  @Column({ type: DataType.TEXT, allowNull: false }) declare reason:
    'GRANT' | 'STAKE' | 'PAYOUT' | 'BONUS_RELEASE'
  @Column({ type: DataType.BIGINT, allowNull: false }) declare delta: string
  @Column({ field: 'balance_after', type: DataType.BIGINT, allowNull: false })
  declare balanceAfter: string
}

import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'bonus_draws', timestamps: false })
export class BonusDrawsModel extends Model<
  InferAttributes<BonusDrawsModel>,
  InferCreationAttributes<BonusDrawsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.TEXT, allowNull: true })
  declare guest_hash: string | null

  @Column({ type: DataType.UUID, allowNull: true })
  declare user_id: string | null

  @Column({ type: DataType.TEXT, allowNull: false })
  declare mode: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare period: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare prize_index: number

  @Column({ type: DataType.TEXT, allowNull: false })
  declare game: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare rounds: number

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare stake: string

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false })
  declare wager_multiplier: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare round_days: number

  @Column({ type: DataType.DATE, allowNull: true })
  declare claimed_at: Date | null

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare created_at: CreationOptional<Date>
}

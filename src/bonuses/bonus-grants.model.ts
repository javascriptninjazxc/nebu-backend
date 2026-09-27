import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'bonus_grants', timestamps: false })
export class BonusGrantsModel extends Model<
  InferAttributes<BonusGrantsModel>,
  InferCreationAttributes<BonusGrantsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare game: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare stake: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare remaining: number

  @Column({ type: DataType.DATE, allowNull: false })
  declare expires_at: Date

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false })
  declare wager_multiplier: string

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare winnings: CreationOptional<string>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare required: CreationOptional<string>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare wagered: CreationOptional<string>

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: literal('FALSE') })
  declare released: CreationOptional<boolean>

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare created_at: CreationOptional<Date>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare balance: CreationOptional<string>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare released_amount: CreationOptional<string>
}

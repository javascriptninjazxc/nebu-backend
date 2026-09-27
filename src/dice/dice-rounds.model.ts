import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'
import type { DiceStatus } from './contracts.js'

@Table({ tableName: 'dice_rounds', timestamps: false })
export class DiceRoundsModel extends Model<
  InferAttributes<DiceRoundsModel>,
  InferCreationAttributes<DiceRoundsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare stake: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare mines: number

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare mask: number

  @Column({ type: DataType.TEXT, allowNull: false })
  declare status: DiceStatus

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('1') })
  declare version: CreationOptional<number>

  @Column({ type: DataType.TEXT, allowNull: false })
  declare rules_version: string

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare payout: CreationOptional<string>

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare created_at: CreationOptional<Date>
}

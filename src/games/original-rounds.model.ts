import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'
import type { CachesData, ChestData, ForestData, OriginalGame } from './contracts.js'

@Table({ tableName: 'original_rounds', timestamps: false })
export class OriginalRoundsModel extends Model<
  InferAttributes<OriginalRoundsModel>,
  InferCreationAttributes<OriginalRoundsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare game: OriginalGame

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare stake: string

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare active: boolean

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('1') })
  declare version: CreationOptional<number>

  @Column({ type: DataType.TEXT, allowNull: false })
  declare rules_version: string

  @Column({ type: DataType.JSONB, allowNull: false })
  declare state: ForestData | CachesData | ChestData

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: literal("'{}'") })
  declare secret: CreationOptional<{ mask?: number }>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare payout: CreationOptional<string>

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('clock_timestamp()') })
  declare created_at: CreationOptional<Date>
}

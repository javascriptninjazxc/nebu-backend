import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'bonus_rounds', timestamps: false })
export class BonusRoundsModel extends Model<
  InferAttributes<BonusRoundsModel>,
  InferCreationAttributes<BonusRoundsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare round_id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare grant_id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare source: string

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: literal('FALSE') })
  declare settled: CreationOptional<boolean>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare won_minor: CreationOptional<string>
}

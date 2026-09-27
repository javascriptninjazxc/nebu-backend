import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'bonus_turnover', timestamps: false })
export class BonusTurnoverModel extends Model<
  InferAttributes<BonusTurnoverModel>,
  InferCreationAttributes<BonusTurnoverModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare round_id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare stake: string

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare created_at: CreationOptional<Date>
}

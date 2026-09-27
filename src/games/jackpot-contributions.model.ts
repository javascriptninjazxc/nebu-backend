import type { InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'jackpot_contributions', timestamps: false })
export class JackpotContributionsModel extends Model<
  InferAttributes<JackpotContributionsModel>,
  InferCreationAttributes<JackpotContributionsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare round_id: string

  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare period_id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare amount: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare weight: string
}

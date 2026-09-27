import type { InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'confirmed_deposits', timestamps: false })
export class ConfirmedDepositsModel extends Model<
  InferAttributes<ConfirmedDepositsModel>,
  InferCreationAttributes<ConfirmedDepositsModel>
> {
  @Column({ type: DataType.TEXT, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare amount_minor: string

  @Column({ type: DataType.DATE, allowNull: false })
  declare confirmed_at: Date

  @Column({ type: DataType.DATE, allowNull: true })
  declare reversed_at: Date | null
}

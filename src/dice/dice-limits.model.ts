import type { InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'dice_limits', timestamps: false })
export class DiceLimitsModel extends Model<
  InferAttributes<DiceLimitsModel>,
  InferCreationAttributes<DiceLimitsModel>
> {
  @Column({ type: DataType.TEXT, allowNull: false, primaryKey: true })
  declare key: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare count: number

  @Column({ type: DataType.DATE, allowNull: false })
  declare expires_at: Date
}

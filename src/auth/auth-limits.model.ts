import type { InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'auth_limits', timestamps: false })
export class AuthLimitsModel extends Model<
  InferAttributes<AuthLimitsModel>,
  InferCreationAttributes<AuthLimitsModel>
> {
  @Column({ type: DataType.TEXT, allowNull: false, primaryKey: true })
  declare key: string

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare count: number

  @Column({ type: DataType.DATE, allowNull: false })
  declare expires_at: Date
}

import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'dice_connections', timestamps: false })
export class DiceConnectionsModel extends Model<
  InferAttributes<DiceConnectionsModel>,
  InferCreationAttributes<DiceConnectionsModel>
> {
  @Column({ type: DataType.TEXT, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.UUID, allowNull: false })
  declare user_id: string

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare session_hash: string

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: literal("NOW() + INTERVAL '90 seconds'"),
  })
  declare expires_at: CreationOptional<Date>
}

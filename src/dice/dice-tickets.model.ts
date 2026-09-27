import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'dice_tickets', timestamps: false })
export class DiceTicketsModel extends Model<
  InferAttributes<DiceTicketsModel>,
  InferCreationAttributes<DiceTicketsModel>
> {
  @Column({ type: DataType.TEXT, allowNull: false, primaryKey: true })
  declare hash: string

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare session_hash: string

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: literal("NOW() + INTERVAL '30 seconds'"),
  })
  declare expires_at: CreationOptional<Date>
}

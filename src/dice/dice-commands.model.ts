import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'
import type { DiceReply } from './contracts.js'

@Table({ tableName: 'dice_commands', timestamps: false })
export class DiceCommandsModel extends Model<
  InferAttributes<DiceCommandsModel>,
  InferCreationAttributes<DiceCommandsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare user_id: string

  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare request_id: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare payload_hash: string

  @Column({ type: DataType.JSONB, allowNull: false })
  declare response: DiceReply

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare created_at: CreationOptional<Date>
}

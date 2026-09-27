import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'jackpot_participants', timestamps: false })
export class JackpotParticipantsModel extends Model<
  InferAttributes<JackpotParticipantsModel>,
  InferCreationAttributes<JackpotParticipantsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare period_id: string

  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare user_id: string

  @Column({ type: DataType.BIGINT, allowNull: false })
  declare weight: string

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('0') })
  declare opened: CreationOptional<number>

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('1') })
  declare version: CreationOptional<number>
}

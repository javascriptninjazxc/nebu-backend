import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'jackpot_outbox', timestamps: false })
export class JackpotOutboxModel extends Model<
  InferAttributes<JackpotOutboxModel>,
  InferCreationAttributes<JackpotOutboxModel>
> {
  @Column({ type: DataType.BIGINT, allowNull: false, primaryKey: true, autoIncrement: true })
  declare id: CreationOptional<string>

  @Column({ type: DataType.UUID, allowNull: false })
  declare period_id: string

  @Column({ type: DataType.DATE, allowNull: true })
  declare published_at: Date | null
}

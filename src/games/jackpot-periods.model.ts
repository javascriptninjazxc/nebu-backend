import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'jackpot_periods', timestamps: false })
export class JackpotPeriodsModel extends Model<
  InferAttributes<JackpotPeriodsModel>,
  InferCreationAttributes<JackpotPeriodsModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare id: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare pool: 'mini' | 'mega'

  @Column({ type: DataType.DATE, allowNull: false })
  declare starts_at: Date

  @Column({ type: DataType.DATE, allowNull: false })
  declare ends_at: Date

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare amount: CreationOptional<string>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare total_weight: CreationOptional<string>

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: literal("'OPEN'") })
  declare status: CreationOptional<'OPEN' | 'DRAWN' | 'EMPTY'>

  @Column({ type: DataType.UUID, allowNull: true })
  declare winner_id: string | null

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: literal('FALSE') })
  declare paid: CreationOptional<boolean>

  @Column({ type: DataType.DATE, allowNull: true })
  declare drawn_at: Date | null
}

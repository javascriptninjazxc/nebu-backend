import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'bonus_settings', timestamps: false })
export class BonusSettingsModel extends Model<
  InferAttributes<BonusSettingsModel>,
  InferCreationAttributes<BonusSettingsModel>
> {
  @Column({ type: DataType.INTEGER, allowNull: false, primaryKey: true })
  declare id: number

  @Column({ type: DataType.DECIMAL(6, 2), allowNull: false, defaultValue: literal('2') })
  declare wager_multiplier: CreationOptional<string>

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('7') })
  declare round_days: CreationOptional<number>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('100000') })
  declare weekly_deposit_minor: CreationOptional<string>
}

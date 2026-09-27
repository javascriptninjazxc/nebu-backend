import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'original_progress', timestamps: false })
export class OriginalProgressModel extends Model<
  InferAttributes<OriginalProgressModel>,
  InferCreationAttributes<OriginalProgressModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare user_id: string

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: literal('0') })
  declare crystals: CreationOptional<number>

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: literal('0') })
  declare crystal_bonus: CreationOptional<string>
}

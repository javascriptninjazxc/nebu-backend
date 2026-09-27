import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize'
import { literal } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'player_profiles', timestamps: false })
export class PlayerProfilesModel extends Model<
  InferAttributes<PlayerProfilesModel>,
  InferCreationAttributes<PlayerProfilesModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare user_id: string

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare display_name: string

  @Column({ type: DataType.TEXT, allowNull: false })
  declare avatar: string

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: literal('NOW()') })
  declare updated_at: CreationOptional<Date>
}

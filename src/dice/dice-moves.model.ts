import type { InferAttributes, InferCreationAttributes } from 'sequelize'
import { Column, DataType, Model, Table } from 'sequelize-typescript'

@Table({ tableName: 'dice_moves', timestamps: false })
export class DiceMovesModel extends Model<
  InferAttributes<DiceMovesModel>,
  InferCreationAttributes<DiceMovesModel>
> {
  @Column({ type: DataType.UUID, allowNull: false, primaryKey: true })
  declare round_id: string

  @Column({ type: DataType.INTEGER, allowNull: false, primaryKey: true })
  declare cell: number

  @Column({ type: DataType.TEXT, allowNull: false })
  declare result: 'safe' | 'mine'

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare sequence: number
}

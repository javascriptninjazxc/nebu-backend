import { Table, Column, Model, DataType } from 'sequelize-typescript'

interface UserAttributes {
  id: string
  login: string
  salt: string
  passwordHash: string
  promo: string | null
  createdAt: Date
}

@Table({ tableName: 'users', timestamps: false })
export class User extends Model<UserAttributes, UserAttributes> {
  @Column({ type: DataType.UUID, primaryKey: true }) declare id: string
  @Column({ type: DataType.STRING(64), unique: true, allowNull: false })
  declare login: string
  @Column({ type: DataType.STRING(32), allowNull: false }) declare salt: string
  @Column({ type: DataType.STRING(128), allowNull: false })
  declare passwordHash: string
  @Column(DataType.STRING(32)) declare promo: string | null
  @Column({ type: DataType.DATE, allowNull: false }) declare createdAt: Date
}
interface SessionAttributes {
  hash: string
  userId: string
  expiresAt: Date
}

@Table({ tableName: 'auth_sessions', timestamps: false })
export class AuthSession extends Model<SessionAttributes, SessionAttributes> {
  @Column({ type: DataType.STRING(64), primaryKey: true }) declare hash: string
  @Column({ type: DataType.UUID, allowNull: false }) declare userId: string
  @Column({ type: DataType.DATE, allowNull: false }) declare expiresAt: Date
}

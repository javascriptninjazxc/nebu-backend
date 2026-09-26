import { DataTypes } from 'sequelize'

export async function up(query, transaction) {
  const options = { transaction }

  await query.createTable(
    'users',
    {
      id: { type: DataTypes.UUID, primaryKey: true },
      login: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      salt: { type: DataTypes.STRING(32), allowNull: false },
      passwordHash: { type: DataTypes.STRING(128), allowNull: false },
      promo: { type: DataTypes.STRING(32) },
      createdAt: { type: DataTypes.DATE, allowNull: false },
    },
    options,
  )
  await query.createTable(
    'auth_sessions',
    {
      hash: { type: DataTypes.STRING(64), primaryKey: true },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
      },
      expiresAt: { type: DataTypes.DATE, allowNull: false },
    },
    options,
  )
  await query.addIndex('auth_sessions', ['expiresAt'], options)
  await query.createTable(
    'auth_limits',
    {
      key: { type: DataTypes.STRING(64), primaryKey: true },
      count: { type: DataTypes.INTEGER, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
    },
    options,
  )
}

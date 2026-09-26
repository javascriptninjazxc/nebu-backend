export async function up(query, transaction) {
  await query.sequelize.query(
    `CREATE TABLE player_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name VARCHAR(32) NOT NULL,
    avatar TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  ); CREATE INDEX profile_ledger_history ON dice_entries(user_id,created_at DESC,id DESC);`,
    { transaction },
  )
}

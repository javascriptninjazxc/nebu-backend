export async function up(query, transaction) {
  await query.sequelize.query(
    'CREATE TABLE chest_free_pushes (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), source_round_id UUID NOT NULL UNIQUE REFERENCES original_rounds(id), used_round_id UUID UNIQUE REFERENCES original_rounds(id), created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()); CREATE UNIQUE INDEX chest_one_pending_gift ON chest_free_pushes(user_id) WHERE used_round_id IS NULL; CREATE INDEX chest_gift_hour ON chest_free_pushes(user_id,created_at);',
    { transaction },
  )
}

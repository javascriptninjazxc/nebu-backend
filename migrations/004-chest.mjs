export async function up(query, transaction) {
  await query.sequelize.query(
    "ALTER TABLE original_rounds DROP CONSTRAINT original_rounds_game_check; ALTER TABLE original_rounds ADD CONSTRAINT original_rounds_game_check CHECK(game IN ('forest','caches','chest'))",
    { transaction },
  )
}

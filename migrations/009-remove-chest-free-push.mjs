// Retire active gift attempts without touching wallets or historical completed results.
export async function up(query, transaction) {
  await query.sequelize.query(
    `
    UPDATE original_rounds
    SET active=FALSE, payout=0, version=version+1,
        state=state || '{"phase":"lost","offerMinor":"0","nextPayoutMinor":"0","nextChanceNumerator":0}'::jsonb
    WHERE game='chest' AND active AND state->>'freePush'='true';
    DROP TABLE IF EXISTS chest_free_pushes;
  `,
    { transaction },
  )
}

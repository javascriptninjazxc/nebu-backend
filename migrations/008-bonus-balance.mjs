export async function up(query, transaction) {
  await query.sequelize.query(
    `
 ALTER TABLE dice_wallets ALTER COLUMN balance SET DEFAULT 0;
 ALTER TABLE dice_entries ADD CONSTRAINT no_new_starter_grants CHECK(reason <> 'GRANT') NOT VALID;
 DROP INDEX IF EXISTS dice_grant_once;
 ALTER TABLE bonus_grants ADD COLUMN balance BIGINT NOT NULL DEFAULT 0 CHECK(balance>=0);
 ALTER TABLE bonus_grants ADD COLUMN released_amount BIGINT NOT NULL DEFAULT 0 CHECK(released_amount>=0);
 UPDATE bonus_grants SET balance=CASE WHEN released THEN 0 ELSE winnings END,released_amount=CASE WHEN released THEN winnings ELSE 0 END;
 CREATE TABLE bonus_bets(round_id UUID PRIMARY KEY,grant_id UUID NOT NULL REFERENCES bonus_grants(id),user_id UUID NOT NULL REFERENCES users(id),stake BIGINT NOT NULL CHECK(stake>0),won_minor BIGINT NOT NULL DEFAULT 0 CHECK(won_minor>=0),settled BOOLEAN NOT NULL DEFAULT FALSE);
 CREATE INDEX bonus_bet_grant ON bonus_bets(grant_id) WHERE NOT settled;
 `,
    { transaction },
  )
}

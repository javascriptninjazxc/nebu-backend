export async function up(query, transaction) {
  await query.sequelize.query(
    `
 CREATE TABLE bonus_settings(id INTEGER PRIMARY KEY CHECK(id=1), wager_multiplier NUMERIC(6,2) NOT NULL DEFAULT 2 CHECK(wager_multiplier BETWEEN 0 AND 100), round_days INTEGER NOT NULL DEFAULT 7 CHECK(round_days BETWEEN 1 AND 365), weekly_deposit_minor BIGINT NOT NULL DEFAULT 100000 CHECK(weekly_deposit_minor>=0));
 INSERT INTO bonus_settings(id) VALUES(1);
 CREATE TABLE bonus_draws(id UUID PRIMARY KEY, guest_hash TEXT, user_id UUID REFERENCES users(id), mode TEXT NOT NULL CHECK(mode IN ('welcome','weekly')), period TEXT NOT NULL, prize_index INTEGER NOT NULL CHECK(prize_index BETWEEN 0 AND 7), game TEXT NOT NULL CHECK(game IN ('forest','caches','dice','chest')), rounds INTEGER NOT NULL CHECK(rounds>0), stake BIGINT NOT NULL CHECK(stake>=1000), wager_multiplier NUMERIC(6,2) NOT NULL, round_days INTEGER NOT NULL, claimed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE UNIQUE INDEX bonus_guest_once ON bonus_draws(guest_hash) WHERE guest_hash IS NOT NULL;
 CREATE UNIQUE INDEX bonus_user_period ON bonus_draws(user_id,mode,period) WHERE user_id IS NOT NULL;
 CREATE TABLE bonus_grants(id UUID PRIMARY KEY REFERENCES bonus_draws(id), user_id UUID NOT NULL REFERENCES users(id), game TEXT NOT NULL, stake BIGINT NOT NULL, remaining INTEGER NOT NULL CHECK(remaining>=0), expires_at TIMESTAMPTZ NOT NULL, wager_multiplier NUMERIC(6,2) NOT NULL, winnings BIGINT NOT NULL DEFAULT 0 CHECK(winnings>=0), required BIGINT NOT NULL DEFAULT 0 CHECK(required>=0), wagered BIGINT NOT NULL DEFAULT 0 CHECK(wagered>=0), released BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE INDEX bonus_grant_user ON bonus_grants(user_id,created_at);
 CREATE TABLE bonus_rounds(round_id UUID PRIMARY KEY, grant_id UUID NOT NULL REFERENCES bonus_grants(id), user_id UUID NOT NULL REFERENCES users(id), source TEXT NOT NULL CHECK(source IN ('dice','original')), settled BOOLEAN NOT NULL DEFAULT FALSE, won_minor BIGINT NOT NULL DEFAULT 0);
 CREATE TABLE bonus_turnover(round_id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), stake BIGINT NOT NULL CHECK(stake>0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE confirmed_deposits(id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), amount_minor BIGINT NOT NULL CHECK(amount_minor>0), confirmed_at TIMESTAMPTZ NOT NULL, reversed_at TIMESTAMPTZ);
 CREATE INDEX deposit_user_period ON confirmed_deposits(user_id,confirmed_at) WHERE reversed_at IS NULL;
 ALTER TABLE dice_entries DROP CONSTRAINT dice_entries_reason_check;
 ALTER TABLE dice_entries ADD CONSTRAINT dice_entries_reason_check CHECK(reason IN ('GRANT','STAKE','PAYOUT','BONUS_RELEASE'));
 ALTER TABLE dice_entries ADD COLUMN bonus_grant_id UUID REFERENCES bonus_grants(id);
 CREATE UNIQUE INDEX bonus_release_once ON dice_entries(bonus_grant_id) WHERE bonus_grant_id IS NOT NULL;
 `,
    { transaction },
  )
}

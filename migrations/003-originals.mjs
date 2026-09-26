export async function up(query, transaction) {
  await query.sequelize.query(
    `
CREATE TABLE original_rounds (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), game TEXT NOT NULL CHECK(game IN ('forest','caches')),
 stake BIGINT NOT NULL CHECK(stake BETWEEN 1000 AND 10000000 AND stake % 100 = 0), active BOOLEAN NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), rules_version TEXT NOT NULL, state JSONB NOT NULL, secret JSONB NOT NULL DEFAULT '{}',
 payout BIGINT NOT NULL DEFAULT 0 CHECK(payout>=0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX original_one_active ON original_rounds(user_id,game) WHERE active;
CREATE INDEX original_history ON original_rounds(user_id,game,created_at DESC);
CREATE TABLE original_progress (user_id UUID PRIMARY KEY REFERENCES users(id), crystals INTEGER NOT NULL DEFAULT 0 CHECK(crystals>=0), crystal_bonus BIGINT NOT NULL DEFAULT 0 CHECK(crystal_bonus>=0));
CREATE TABLE original_commands (user_id UUID NOT NULL REFERENCES users(id), request_id UUID NOT NULL, payload_hash TEXT NOT NULL, response JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,request_id));
CREATE TABLE jackpot_periods (
 id UUID PRIMARY KEY, pool TEXT NOT NULL CHECK(pool IN ('mini','mega')), starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
 amount BIGINT NOT NULL DEFAULT 0 CHECK(amount>=0), total_weight BIGINT NOT NULL DEFAULT 0 CHECK(total_weight>=0),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DRAWN','EMPTY')), winner_id UUID REFERENCES users(id),
 paid BOOLEAN NOT NULL DEFAULT FALSE, drawn_at TIMESTAMPTZ, UNIQUE(pool,starts_at), CHECK(ends_at>starts_at)
);
CREATE INDEX jackpot_due ON jackpot_periods(ends_at) WHERE status='OPEN';
CREATE TABLE jackpot_participants (
 period_id UUID NOT NULL REFERENCES jackpot_periods(id), user_id UUID NOT NULL REFERENCES users(id), weight BIGINT NOT NULL CHECK(weight>0),
 opened INTEGER NOT NULL DEFAULT 0 CHECK(opened BETWEEN 0 AND 7), version INTEGER NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(period_id,user_id)
);
CREATE INDEX jackpot_user ON jackpot_participants(user_id);
CREATE TABLE jackpot_contributions (round_id UUID NOT NULL REFERENCES original_rounds(id), period_id UUID NOT NULL REFERENCES jackpot_periods(id),
 user_id UUID NOT NULL REFERENCES users(id), amount BIGINT NOT NULL CHECK(amount>0), weight BIGINT NOT NULL CHECK(weight>0), PRIMARY KEY(round_id,period_id));
CREATE TABLE jackpot_outbox (id BIGSERIAL PRIMARY KEY, period_id UUID NOT NULL UNIQUE REFERENCES jackpot_periods(id), published_at TIMESTAMPTZ);
ALTER TABLE dice_entries ADD COLUMN game_round_id UUID REFERENCES original_rounds(id);
ALTER TABLE dice_entries ADD COLUMN jackpot_period_id UUID REFERENCES jackpot_periods(id);
CREATE UNIQUE INDEX original_entry_once ON dice_entries(game_round_id,reason) WHERE game_round_id IS NOT NULL;
CREATE UNIQUE INDEX jackpot_entry_once ON dice_entries(jackpot_period_id,reason) WHERE jackpot_period_id IS NOT NULL;
ALTER TABLE dice_entries ADD CONSTRAINT dice_entry_single_source CHECK(num_nonnulls(round_id,game_round_id,jackpot_period_id)<=1);
`,
    { transaction },
  )
}

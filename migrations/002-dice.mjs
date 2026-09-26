export async function up(query, transaction) {
  await query.sequelize.query(
    `
CREATE TABLE dice_wallets (user_id UUID PRIMARY KEY REFERENCES users(id), balance BIGINT NOT NULL CHECK(balance>=0), version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE dice_rounds (
id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), stake BIGINT NOT NULL CHECK(stake BETWEEN 1000 AND 10000000 AND stake%100=0),
mines INTEGER NOT NULL CHECK(mines BETWEEN 1 AND 10), mask INTEGER NOT NULL CHECK(mask BETWEEN 1 AND 33554431),
status TEXT NOT NULL CHECK(status IN ('ACTIVE','LOST','WON','CASHED_OUT')), version INTEGER NOT NULL DEFAULT 1,
rules_version TEXT NOT NULL, payout BIGINT NOT NULL DEFAULT 0 CHECK(payout>=0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX dice_one_active ON dice_rounds(user_id) WHERE status='ACTIVE';
CREATE INDEX dice_history ON dice_rounds(user_id,created_at DESC);
CREATE TABLE dice_moves (round_id UUID NOT NULL REFERENCES dice_rounds(id), cell INTEGER NOT NULL CHECK(cell BETWEEN 0 AND 24),
result TEXT NOT NULL CHECK(result IN ('safe','mine')), sequence INTEGER NOT NULL, PRIMARY KEY(round_id,cell), UNIQUE(round_id,sequence));
CREATE TABLE dice_entries (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), round_id UUID REFERENCES dice_rounds(id),
reason TEXT NOT NULL CHECK(reason IN ('GRANT','STAKE','PAYOUT')), delta BIGINT NOT NULL, balance_after BIGINT NOT NULL CHECK(balance_after>=0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE UNIQUE INDEX dice_grant_once ON dice_entries(user_id) WHERE reason='GRANT';
CREATE UNIQUE INDEX dice_entry_once ON dice_entries(round_id,reason) WHERE round_id IS NOT NULL;
CREATE TABLE dice_commands (user_id UUID NOT NULL REFERENCES users(id), request_id UUID NOT NULL, payload_hash TEXT NOT NULL, response JSONB NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,request_id));
CREATE TABLE dice_tickets (hash TEXT PRIMARY KEY, session_hash VARCHAR(64) NOT NULL REFERENCES auth_sessions(hash) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE dice_connections (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id), session_hash VARCHAR(64) NOT NULL REFERENCES auth_sessions(hash) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL);
CREATE INDEX dice_connections_user ON dice_connections(user_id);
CREATE TABLE dice_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL);
`,
    { transaction },
  )
}

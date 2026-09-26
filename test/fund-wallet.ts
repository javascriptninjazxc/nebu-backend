import { randomUUID } from 'node:crypto'
import type { Sequelize } from 'sequelize-typescript'

// Explicit test fixture, never called by application code.
export async function fundTestWallet(db: Sequelize, user: string) {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
  ) {
    throw Error('Separate test database required')
  }

  await db.transaction(async (transaction) => {
    await db.query('INSERT INTO dice_wallets(user_id,balance,version) VALUES(:user,1000000,1)', {
      replacements: { user },
      transaction,
    })
    await db.query(
      "INSERT INTO dice_entries(id,user_id,reason,delta,balance_after) VALUES(:id,:user,'PAYOUT',1000000,1000000)",
      { replacements: { id: randomUUID(), user }, transaction },
    )
  })
}

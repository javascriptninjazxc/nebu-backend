import { up as removeChestFreePush } from '../migrations/009-remove-chest-free-push.mjs'
import { up as bonusBalance } from '../migrations/008-bonus-balance.mjs'
import { up as bonusWheel } from '../migrations/007-bonus-wheel.mjs'
import { up as profile } from '../migrations/006-profile.mjs'
import { up as chestBonuses } from '../migrations/005-chest-bonuses.mjs'
import { up as chest } from '../migrations/004-chest.mjs'
import { up as originals } from '../migrations/003-originals.mjs'
import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { Sequelize, QueryTypes } from 'sequelize'
import { up } from '../migrations/001-auth.mjs'
import { up as dice } from '../migrations/002-dice.mjs'

if (existsSync('.env')) {
  loadEnvFile('.env')
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required')
}

const db = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: process.env.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {},
})

try {
  await db.transaction(async (transaction) => {
    await db.query('SELECT pg_advisory_xact_lock(70419001)', { transaction })
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)', {
      transaction,
    })

    for (const [name, migrate] of [
      ['001-auth', up],
      ['002-dice', dice],
      ['003-originals', originals],
      ['004-chest', chest],
      ['005-chest-bonuses', chestBonuses],
      ['006-profile', profile],
      ['007-bonus-wheel', bonusWheel],
      ['008-bonus-balance', bonusBalance],
      ['009-remove-chest-free-push', removeChestFreePush],
    ]) {
      const done = await db.query('SELECT name FROM schema_migrations WHERE name = :name', {
        replacements: { name },
        transaction,
        type: QueryTypes.SELECT,
      })

      if (!done.length) {
        await migrate(db.getQueryInterface(), transaction)
        await db.query('INSERT INTO schema_migrations VALUES (:name)', {
          replacements: { name },
          transaction,
        })
      }
    }
  })
  console.log('Migrations complete')
} finally {
  await db.close()
}

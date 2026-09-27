import { Inject, Injectable } from '@nestjs/common'
import { Sequelize } from 'sequelize-typescript'
import { LiveWinsRepository } from './live-wins.repository.js'

@Injectable()
export class LiveWinsService {
  constructor(
    @Inject(LiveWinsRepository) private readonly repository: LiveWinsRepository,
    @Inject(Sequelize) private readonly db: Sequelize,
  ) {}

  async players() {
    const rows = await this.repository.activePlayers()

    return {
      period: '24h',
      games: Object.fromEntries(
        ['forest', 'caches', 'dice', 'chest'].map((game) => [
          game,
          rows.find((row) => row.game === game)?.players ?? 0,
        ]),
      ),
    }
  }

  async get() {
    const rows = await this.repository.recentWins()

    return { wins: rows }
  }
}

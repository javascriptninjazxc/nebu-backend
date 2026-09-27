import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { literal, Op, Transaction } from 'sequelize'
import { DiceError } from '../dice/errors.js'
import { DiceWallet } from '../dice/models.js'
import { GameAccountService } from './account.service.js'
import type { JackpotDraw, NetworkState } from './contracts.js'
import type { DrawDto, DrawRevealDto } from './dto.js'
import { JackpotContributionsModel } from './jackpot-contributions.model.js'
import { JackpotOutboxModel } from './jackpot-outbox.model.js'
import { JackpotParticipantsModel } from './jackpot-participants.model.js'
import { JackpotPeriodsModel } from './jackpot-periods.model.js'
import { NetworkJackpotsRepository } from './network-jackpots.repository.js'
import type { Participation } from './network-jackpots.types.js'
import { OriginalsRandom, periodWindow } from './random.js'

@Injectable()
export class NetworkJackpotsService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(NetworkJackpotsRepository) private readonly repository: NetworkJackpotsRepository,
    @Inject(GameAccountService) private readonly accounts: GameAccountService,
    @Inject(OriginalsRandom) private readonly random: OriginalsRandom,
  ) {}

  private timer?: ReturnType<typeof setInterval>

  private running = false

  private logger = new Logger(NetworkJackpotsService.name)

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick()
    }, 5000)
    this.timer.unref()
    void this.tick()
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
    }
  }

  private async tick() {
    if (this.running) {
      return
    }

    this.running = true

    try {
      await this.settleDue()
    } catch {
      this.logger.error('Jackpot draw deferred; persistent periods will be retried')
    } finally {
      this.running = false
    }
  }

  async now(t: Transaction) {
    const [clock] = await this.repository.clock(t)

    return new Date(clock.now)
  }

  async contribute(user: string, round: string, stake: string, t: Transaction) {
    // One short global schedule lock gives both pools the same acceptance time and prevents closing across a contribution.
    await this.repository.lockSchedule(t)

    const now = await this.now(t)

    for (const pool of ['mini', 'mega'] as const) {
      const window = periodWindow(pool, now)

      const contribution = (BigInt(stake) / 100n).toString()

      const [period] = await this.repository.ensurePeriod(
        { id: randomUUID(), pool, start: window.start, end: window.end },
        t,
      )

      await JackpotContributionsModel.create(
        {
          round_id: round,
          period_id: period.id,
          user_id: user,
          amount: contribution,
          weight: stake,
        },
        { transaction: t },
      )
      await this.repository.contributeToPeriod({ id: period.id, amount: contribution, stake }, t)
      await this.repository.contributeToParticipant({ period: period.id, user, stake }, t)
    }
  }

  async settleDue() {
    return this.accounts.db.transaction(async (t) => {
      await this.repository.setLockTimeout(t)
      await this.repository.setStatementTimeout(t)

      const [lock] = await this.repository.tryLockSchedule(t)

      if (!lock.locked) {
        return 0
      }

      const due = await JackpotPeriodsModel.findAll({
        where: {
          [Op.and]: [{ status: 'OPEN' }, { ends_at: { [Op.lte]: literal('clock_timestamp()') } }],
        },
        order: [
          ['ends_at', 'ASC'],
          ['id', 'ASC'],
        ],
        limit: 100,
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
        raw: true,
      })

      for (const period of due) {
        if (BigInt(period.total_weight) === 0n) {
          await JackpotPeriodsModel.update(
            { status: 'EMPTY', drawn_at: literal('NOW()') },
            { where: { id: period.id }, transaction: t },
          )
          continue
        }

        const participants = await JackpotParticipantsModel.findAll({
          attributes: ['user_id', 'weight'],
          where: { period_id: period.id },
          order: [['user_id', 'ASC']],
          transaction: t,
          raw: true,
        })

        const total = participants.reduce((sum, p) => sum + BigInt(p.weight), 0n)

        if (total !== BigInt(period.total_weight)) {
          throw new Error('Jackpot weight mismatch')
        }

        let ticket = this.random.weighted(total)

        let winner: string | undefined

        for (const person of participants) {
          ticket -= BigInt(person.weight)

          if (ticket < 0n) {
            winner = person.user_id
            break
          }
        }

        if (!winner) {
          throw new Error('No winner')
        }

        await JackpotPeriodsModel.update(
          { status: 'DRAWN', winner_id: winner, drawn_at: literal('NOW()') },
          { where: { id: period.id }, transaction: t },
        )
        await JackpotOutboxModel.create({ period_id: period.id }, { transaction: t })
      }

      return due.length
    })
  }

  async notifications(emit: (eventId: string) => void) {
    await this.accounts.db.transaction(async (t) => {
      const rows = await JackpotOutboxModel.findAll({
        attributes: ['id'],
        where: { published_at: null },
        order: [['id', 'ASC']],
        limit: 100,
        transaction: t,
        lock: Transaction.LOCK.UPDATE,
        skipLocked: true,
        raw: true,
      })

      for (const row of rows) {
        emit(row.id)
        await JackpotOutboxModel.update(
          { published_at: literal('NOW()') },
          { where: { id: row.id }, transaction: t },
        )
      }
    })
  }

  private present(p: Participation, user: string): JackpotDraw {
    const winner = p.winner_id === user

    return {
      drawId: p.id,
      pool: p.pool,
      amountMinor: p.amount,
      endsAt: new Date(p.ends_at).toISOString(),
      version: p.version,
      cards: [0, 1, 2]
        .filter((i) => Boolean(p.opened & (1 << i)))
        .map((index) => ({
          index,
          symbol: winner ? 'nebi' : (['nebi', 'crystal', 'coin'] as const)[index],
        })),
      result: p.opened !== 7 ? 'pending' : winner ? (p.paid ? 'paid' : 'won') : 'lost',
    }
  }

  async view(user: string, t: Transaction, drawId?: string): Promise<NetworkState> {
    const now = await this.now(t)

    const pools = await Promise.all(
      (['mini', 'mega'] as const).map(async (id) => {
        const window = periodWindow(id, now)

        const pool = await JackpotPeriodsModel.findOne({
          attributes: ['amount'],
          where: { pool: id, starts_at: window.start },
          transaction: t,
          raw: true,
        })

        return {
          id,
          amountMinor: pool?.amount ?? '0',
          endsAt: window.end.toISOString(),
          contributionBasisPoints: 100,
        }
      }),
    )

    // Every participant can reveal the result; only unpaid winners remain after all cards are opened.
    const rows = await this.repository.findPendingDraws({ user }, t)

    let draw: JackpotDraw | null = null

    if (drawId) {
      const [row] = await this.repository.findDraw({ user, id: drawId }, t)

      if (!row) {
        throw new DiceError('DRAW_NOT_FOUND', 'Розыгрыш не найден.')
      }

      draw = this.present(row, user)
    }

    const wallet = await DiceWallet.findOne({
      rejectOnEmpty: true,
      attributes: ['balance', 'version'],
      where: { userId: user },
      transaction: t,
      raw: true,
    })

    return {
      balanceMinor: wallet.balance,
      walletVersion: wallet.version,
      serverTime: now.toISOString(),
      pools,
      pending: rows.slice(0, 20).map((p) => this.present(p, user)),
      hasMore: rows.length > 20,
      draw,
    }
  }

  async action(user: string, event: string, dto: DrawDto, t: Transaction) {
    const [period] = await this.repository.lockParticipantPeriod({ id: dto.drawId, user }, t)

    if (!period) {
      throw new DiceError('DRAW_NOT_FOUND', 'Розыгрыш не найден.')
    }

    const participant = await JackpotParticipantsModel.findOne({
      rejectOnEmpty: true,
      attributes: ['opened', 'version'],
      where: { period_id: dto.drawId, user_id: user },
      transaction: t,
      lock: Transaction.LOCK.UPDATE,
      raw: true,
    })

    if (participant.version !== dto.expectedVersion) {
      throw new DiceError('VERSION_CONFLICT', 'Розыгрыш изменился. Обновляем состояние.')
    }

    if (event === 'jackpots.reveal') {
      const index = (dto as DrawRevealDto).cardIndex

      if (participant.opened & (1 << index)) {
        throw new DiceError('CELL_ALREADY_OPENED', 'Карта уже открыта.')
      }

      await this.repository.revealCard({ id: dto.drawId, user, bit: 1 << index }, t)
    } else {
      if (participant.opened !== 7) {
        throw new DiceError('CLAIM_NOT_READY', 'Сначала открой три карты.')
      }

      if (period.winner_id !== user) {
        throw new DiceError('NOT_WINNER', 'В этом розыгрыше приз получил другой участник.')
      }

      if (!period.paid) {
        await this.accounts.money(user, period.id, period.amount, 'PAYOUT', t, 'jackpot')
        await JackpotPeriodsModel.update(
          { paid: true },
          { where: { id: period.id }, transaction: t },
        )
        await JackpotParticipantsModel.update(
          { version: literal('"version"+1') },
          {
            where: { period_id: period.id, user_id: user },
            transaction: t,
          },
        )
      }
    }

    return this.view(user, t, dto.drawId)
  }
}

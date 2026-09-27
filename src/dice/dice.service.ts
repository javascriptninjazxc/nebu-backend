import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { literal, Op, Transaction } from 'sequelize'
import { digest as hash } from '../auth/password.utils.js'
import { GameAccountService } from '../games/account.service.js'
import type { Identity } from '../games/account.types.js'
import type { DiceEvent, DiceReply, DiceRound, DiceState, DiceStatus } from './contracts.js'
import { DiceCommandsModel } from './dice-commands.model.js'
import { DiceMovesModel } from './dice-moves.model.js'
import { DiceRoundsModel } from './dice-rounds.model.js'
import { DiceRepository } from './dice.repository.js'
import type { Round } from './dice.types.js'
import type { CommandDto, RevealDto, RoundDto, StartDto, StatusDto, SyncDto } from './dto.js'
import { DiceError } from './errors.js'
import { DiceRandom, multiplier, payout, RULES_VERSION } from './math.js'
import { DiceWallet } from './models.js'

@Injectable()
export class DiceService {
  constructor(
    @Inject(DiceRepository) private readonly repository: DiceRepository,
    @Inject(GameAccountService) private readonly accounts: GameAccountService,
    @Inject(DiceRandom) private readonly random: DiceRandom,
  ) {}

  ticket(token: string) {
    return this.accounts.ticket(token)
  }

  connect(ticket: unknown, id: string) {
    return this.accounts.connect(ticket, id)
  }

  limit(key: string, max: number, seconds: number) {
    return this.accounts.limit(key, max, seconds)
  }

  heartbeat(id: string, who: Identity) {
    return this.accounts.heartbeat(id, who)
  }

  disconnect(id: string) {
    return this.accounts.disconnect(id)
  }

  cleanup() {
    return this.accounts.cleanup()
  }

  private async present(r: Round, t: Transaction): Promise<DiceRound> {
    const moves = await DiceMovesModel.findAll({
      attributes: ['cell', 'result'],
      where: { round_id: r.id },
      order: [['sequence', 'ASC']],
      transaction: t,
      raw: true,
    })

    const opened = moves.filter((m) => m.result === 'safe').length

    return {
      roundId: r.id,
      version: r.version,
      status: r.status,
      stakeMinor: r.stake,
      mines: r.mines,
      rulesVersion: r.rules_version,
      openedCells: moves.map((m) => ({ index: m.cell, result: m.result })),
      multiplierHundredths: multiplier(r.mines, opened),
      nextMultiplierHundredths:
        r.status === 'ACTIVE' && opened < 25 - r.mines ? multiplier(r.mines, opened + 1) : null,
      cashoutMinor: r.status === 'ACTIVE' ? payout(r.stake, r.mines, opened) : '0',
      settledPayoutMinor: r.payout,
    }
  }

  private async state(user: string, t: Transaction, roundId?: string): Promise<DiceState> {
    const wallet = await DiceWallet.findOne({
      rejectOnEmpty: true,
      attributes: ['balance', 'version'],
      where: { userId: user },
      transaction: t,
      raw: true,
    })

    const rounds = await DiceRoundsModel.findAll({
      where: { user_id: user },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 8,
      transaction: t,
      raw: true,
    })

    let round = rounds.find((r) => r.status === 'ACTIVE') ?? rounds[0]

    if (roundId) {
      const selected = await DiceRoundsModel.findOne({
        where: { user_id: user, id: roundId },
        transaction: t,
        raw: true,
      })

      if (!selected) {
        throw new DiceError('ROUND_NOT_FOUND', 'Раунд не найден.')
      }

      round = selected
    }

    return {
      bonusGrants: await this.accounts.bonuses.grants(user, t),
      balanceMinor: wallet.balance,
      walletVersion: wallet.version,
      round: round ? await this.present(round, t) : null,
      history: await Promise.all(
        rounds.filter((r) => r.status !== 'ACTIVE').map((r) => this.present(r, t)),
      ),
    }
  }

  async command(identity: Identity, event: DiceEvent, input: CommandDto): Promise<DiceReply> {
    return this.accounts.db.transaction(async (t) => {
      await this.repository.setLockTimeout(t)
      await this.repository.setStatementTimeout(t)

      const who = await this.accounts.session(identity.sessionHash, t)

      if (who.userId !== identity.userId) {
        throw new DiceError('UNAUTHENTICATED', 'Войди заново.')
      }

      // Account-wide DB lock serializes tabs and backend processes, including first wallet creation.
      await this.repository.lockAccount({ user: who.userId }, t)

      const user = who.userId

      const canonical = JSON.stringify([
        event,
        Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
      ])

      const payloadHash = hash(canonical)

      const previous = await DiceCommandsModel.findOne({
        attributes: ['payload_hash', 'response'],
        where: { user_id: user, request_id: input.requestId },
        transaction: t,
        raw: true,
      })

      if (previous) {
        if (previous.payload_hash !== payloadHash) {
          throw new DiceError(
            'IDEMPOTENCY_CONFLICT',
            'Этот ID уже использован для другого действия.',
          )
        }

        return previous.response
      }

      const wallet = await this.accounts.wallet(user, t)

      if (event === 'dice.commandStatus') {
        const saved = await DiceCommandsModel.findOne({
          attributes: ['response'],
          where: {
            user_id: user,
            request_id: (input as StatusDto).operationId,
          },
          transaction: t,
          raw: true,
        })

        return {
          ok: true,
          requestId: input.requestId,
          data: { response: saved?.response ?? null },
        }
      }

      if (event === 'dice.sync') {
        return {
          ok: true,
          requestId: input.requestId,
          data: await this.state(user, t, (input as SyncDto).roundId),
        }
      }

      let roundId: string

      if (event === 'dice.start') {
        if (
          (
            await DiceRoundsModel.findAll({
              attributes: ['id'],
              where: { user_id: user, status: 'ACTIVE' },
              transaction: t,
              raw: true,
            })
          ).length
        ) {
          throw new DiceError('ACTIVE_ROUND_EXISTS', 'Сначала заверши текущий раунд.')
        }

        const dto = input as StartDto

        if (dto.bonusGrantId && dto.bonusWalletId) {
          throw new DiceError('VALIDATION_ERROR', 'Выбери один источник ставки.')
        }

        const stake = BigInt(dto.stakeMinor)

        if (stake < 1000n || stake > 10000000n || stake % 100n !== 0n) {
          throw new DiceError('VALIDATION_ERROR', 'Ставка от 10 до 100 000 целых фишек.')
        }

        if (!dto.bonusGrantId && !dto.bonusWalletId && BigInt(wallet.balance) < stake) {
          throw new DiceError('INSUFFICIENT_FUNDS', 'Недостаточно фишек.')
        }

        roundId = randomUUID()
        await DiceRoundsModel.create(
          {
            id: roundId,
            user_id: user,
            stake: dto.stakeMinor,
            mines: dto.mines,
            mask: this.random.field(dto.mines),
            status: 'ACTIVE',
            rules_version: RULES_VERSION,
          },
          { transaction: t },
        )

        if (dto.bonusGrantId) {
          await this.accounts.bonuses.consume(
            user,
            dto.bonusGrantId,
            'dice',
            dto.stakeMinor,
            roundId,
            'dice',
            t,
          )
        }

        if (dto.bonusWalletId) {
          await this.accounts.bonuses.consumeBalance(
            user,
            dto.bonusWalletId,
            dto.stakeMinor,
            roundId,
            t,
          )
        }

        if (!dto.bonusGrantId && !dto.bonusWalletId) {
          await this.accounts.money(user, roundId, (-stake).toString(), 'STAKE', t)
        }
      } else {
        const dto = input as RoundDto

        roundId = dto.roundId

        const round = await DiceRoundsModel.findOne({
          where: { id: roundId, user_id: user },
          transaction: t,
          lock: Transaction.LOCK.UPDATE,
          raw: true,
        })

        if (!round) {
          throw new DiceError('ROUND_NOT_FOUND', 'Раунд не найден.')
        }

        if (round.status !== 'ACTIVE') {
          throw new DiceError('ROUND_FINISHED', 'Раунд уже завершён.')
        }

        if (round.version !== dto.expectedVersion) {
          throw new DiceError('VERSION_CONFLICT', 'Раунд изменился. Обновляем состояние.')
        }

        if (round.rules_version !== RULES_VERSION) {
          throw new DiceError('TEMPORARILY_UNAVAILABLE', 'Версия правил недоступна.', true)
        }

        const moves = await DiceMovesModel.findAll({
          attributes: ['cell', 'result'],
          where: { round_id: roundId },
          transaction: t,
          raw: true,
        })

        let opened = moves.length

        let status: DiceStatus = 'ACTIVE'

        let award = '0'

        if (event === 'dice.reveal') {
          const cell = (dto as RevealDto).cellIndex

          if (moves.some((m) => m.cell === cell)) {
            throw new DiceError('CELL_ALREADY_OPENED', 'Клетка уже открыта.')
          }

          const mine = Boolean(round.mask & (1 << cell))

          await DiceMovesModel.create(
            { round_id: roundId, cell, result: mine ? 'mine' : 'safe', sequence: opened + 1 },
            { transaction: t },
          )

          if (mine) {
            status = 'LOST'
          } else if (++opened === 25 - round.mines) {
            status = 'WON'
          }
        } else {
          if (!opened) {
            throw new DiceError('CASHOUT_NOT_AVAILABLE', 'Сначала открой безопасную клетку.')
          }

          status = 'CASHED_OUT'
        }

        if (status === 'WON' || status === 'CASHED_OUT') {
          award = payout(round.stake, round.mines, opened)
          await this.accounts.money(user, roundId, award, 'PAYOUT', t)
        }

        await DiceRoundsModel.update(
          { status, payout: award, version: literal('"version"+1') },
          { where: { id: roundId }, transaction: t },
        )
      }

      const finished = await DiceRoundsModel.findOne({
        rejectOnEmpty: true,
        attributes: ['status'],
        where: { id: roundId },
        transaction: t,
        raw: true,
      })

      if (finished.status !== 'ACTIVE') {
        await this.accounts.bonuses.settled(user, roundId, 'dice', t)
      }

      const data = await this.state(user, t, roundId)

      // Only the chosen cell is included in the move response. Sync restores previously opened cells.
      if (event === 'dice.reveal' && data.round) {
        data.round.openedCells = data.round.openedCells.filter(
          (c) => c.index === (input as RevealDto).cellIndex,
        )
      }

      const response: DiceReply = {
        ok: true,
        requestId: input.requestId,
        data,
      }

      await DiceCommandsModel.create(
        {
          user_id: user,
          request_id: input.requestId,
          payload_hash: payloadHash,
          response,
        },
        { transaction: t },
      )

      return response
    })
  }
}

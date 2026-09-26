import { Inject, Injectable } from '@nestjs/common'
import type { Transaction } from 'sequelize'
import { createHash, randomUUID } from 'node:crypto'
import { GameAccountService } from '../games/account.service.js'
import { DiceRandom, multiplier, payout, RULES_VERSION } from './math.js'
import { DiceError } from './errors.js'
import type { DiceEvent, DiceReply, DiceRound, DiceState, DiceStatus } from './contracts.js'
import type { CommandDto, StartDto, RevealDto, RoundDto, SyncDto, StatusDto } from './dto.js'

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

type Round = {
  id: string
  user_id: string
  stake: string
  mines: number
  mask: number
  status: DiceStatus
  version: number
  rules_version: string
  payout: string
}
type Wallet = { balance: string; version: number }
type Move = { cell: number; result: 'safe' | 'mine' }

export type Identity = { userId: string; sessionHash: string }

@Injectable()
export class DiceService {
  constructor(
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
    const moves = await this.accounts.rows<Move>(
      'SELECT cell,result FROM dice_moves WHERE round_id=:id ORDER BY sequence',
      { id: r.id },
      t,
    )

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
    const [wallet] = await this.accounts.rows<Wallet>(
      'SELECT balance,version FROM dice_wallets WHERE user_id=:user',
      { user },
      t,
    )

    const rounds = await this.accounts.rows<Round>(
      'SELECT * FROM dice_rounds WHERE user_id=:user ORDER BY created_at DESC,id DESC LIMIT 8',
      { user },
      t,
    )

    let round = rounds.find((r) => r.status === 'ACTIVE') ?? rounds[0]

    if (roundId) {
      const [selected] = await this.accounts.rows<Round>(
        'SELECT * FROM dice_rounds WHERE user_id=:user AND id=:roundId',
        { user, roundId },
        t,
      )

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
      await this.accounts.rows("SET LOCAL lock_timeout = '3s'", {}, t)
      await this.accounts.rows("SET LOCAL statement_timeout = '5s'", {}, t)

      const who = await this.accounts.session(identity.sessionHash, t)

      if (who.userId !== identity.userId) {
        throw new DiceError('UNAUTHENTICATED', 'Войди заново.')
      }

      // Account-wide DB lock serializes tabs and backend processes, including first wallet creation.
      await this.accounts.rows(
        'SELECT pg_advisory_xact_lock(hashtextextended(:user, 70419))',
        { user: who.userId },
        t,
      )

      const user = who.userId

      const canonical = JSON.stringify([
        event,
        Object.entries(input).sort(([a], [b]) => a.localeCompare(b)),
      ])

      const payloadHash = hash(canonical)

      const [previous] = await this.accounts.rows<{
        payload_hash: string
        response: DiceReply
      }>(
        'SELECT payload_hash,response FROM dice_commands WHERE user_id=:user AND request_id=:request',
        { user, request: input.requestId },
        t,
      )

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
        const [saved] = await this.accounts.rows<{ response: DiceReply }>(
          'SELECT response FROM dice_commands WHERE user_id=:user AND request_id=:request',
          { user, request: (input as StatusDto).operationId },
          t,
        )

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
            await this.accounts.rows(
              "SELECT id FROM dice_rounds WHERE user_id=:user AND status='ACTIVE'",
              { user },
              t,
            )
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
        await this.accounts.rows(
          "INSERT INTO dice_rounds(id,user_id,stake,mines,mask,status,rules_version) VALUES(:id,:user,:stake,:mines,:mask,'ACTIVE',:rules) RETURNING id",
          {
            id: roundId,
            user,
            stake: dto.stakeMinor,
            mines: dto.mines,
            mask: this.random.field(dto.mines),
            rules: RULES_VERSION,
          },
          t,
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

        const [round] = await this.accounts.rows<Round>(
          'SELECT * FROM dice_rounds WHERE id=:id AND user_id=:user FOR UPDATE',
          { id: roundId, user },
          t,
        )

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

        const moves = await this.accounts.rows<Move>(
          'SELECT cell,result FROM dice_moves WHERE round_id=:id',
          { id: roundId },
          t,
        )

        let opened = moves.length

        let status: DiceStatus = 'ACTIVE'

        let award = '0'

        if (event === 'dice.reveal') {
          const cell = (dto as RevealDto).cellIndex

          if (moves.some((m) => m.cell === cell)) {
            throw new DiceError('CELL_ALREADY_OPENED', 'Клетка уже открыта.')
          }

          const mine = Boolean(round.mask & (1 << cell))

          await this.accounts.rows(
            'INSERT INTO dice_moves(round_id,cell,result,sequence) VALUES(:id,:cell,:result,:sequence) RETURNING cell',
            {
              id: roundId,
              cell,
              result: mine ? 'mine' : 'safe',
              sequence: opened + 1,
            },
            t,
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

        await this.accounts.rows(
          'UPDATE dice_rounds SET status=:status,payout=:award,version=version+1 WHERE id=:id RETURNING id',
          { id: roundId, status, award },
          t,
        )
      }

      const [finished] = await this.accounts.rows<{ status: string }>(
        'SELECT status FROM dice_rounds WHERE id=:id',
        { id: roundId },
        t,
      )

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

      await this.accounts.rows(
        'INSERT INTO dice_commands(user_id,request_id,payload_hash,response) VALUES(:user,:request,:hash,CAST(:response AS JSONB)) RETURNING request_id',
        {
          user,
          request: input.requestId,
          hash: payloadHash,
          response: JSON.stringify(response),
        },
        t,
      )

      return response
    })
  }
}

import { Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { Op, Transaction } from 'sequelize'
import { digest } from '../auth/password.utils.js'
import { BonusBetsModel } from '../bonuses/bonus-bets.model.js'
import { BonusRoundsModel } from '../bonuses/bonus-rounds.model.js'
import type { CommandDto, RoundDto, StatusDto, SyncDto } from '../dice/dto.js'
import { DiceError } from '../dice/errors.js'
import { DiceWallet } from '../dice/models.js'
import { GameAccountService } from './account.service.js'
import type { Identity } from './account.types.js'
import {
  CHEST_BONUS_ODDS,
  CHEST_ITEMS,
  CHEST_ODDS,
  chestBoostedPay,
  chestFraction,
  chestKey,
  chestPay,
  chestV3Odds,
  chestV3Value,
} from './chest-rules.js'
import { CHEST_V4_SURVIVAL, calculateSpinOutcome, chestV4Value } from './chest-v4.js'
import {
  CHEST_V5_SURVIVAL,
  calculateSpinOutcome as calculateV5Outcome,
  chestV5Value,
} from './chest-v5.js'
import type {
  CachesData,
  ChestData,
  ForestData,
  OriginalGame,
  OriginalRound,
  OriginalState,
  OriginalsEvent,
  OriginalsReply,
} from './contracts.js'
import type {
  CacheRevealDto,
  CacheStartDto,
  DrawDto,
  ForestSpinDto,
  ForestStartDto,
  JackpotSyncDto,
} from './dto.js'
import { NetworkJackpotsService } from './network-jackpots.service.js'
import { OriginalCommandsModel } from './original-commands.model.js'
import { OriginalProgressModel } from './original-progress.model.js'
import { OriginalRoundsModel } from './original-rounds.model.js'
import { TAU } from './originals.constants.js'
import { OriginalsRepository } from './originals.repository.js'
import type { Round } from './originals.types.js'
import { FOREST_SECTORS, OriginalsRandom, cachePay, forestPay } from './random.js'

@Injectable()
export class OriginalsService {
  constructor(
    @Inject(OriginalsRepository) private readonly repository: OriginalsRepository,
    @Inject(GameAccountService) private readonly account: GameAccountService,
    @Inject(OriginalsRandom) private readonly random: OriginalsRandom,
    @Inject(NetworkJackpotsService)
    private readonly jackpots: NetworkJackpotsService,
  ) {}

  private present(r: Round): OriginalRound {
    const state = r.state

    // Explicit public objects: never spread the DB row or private secret.
    const data: ForestData | CachesData | ChestData =
      r.game === 'chest'
        ? ((s: ChestData) => ({
            freePush: s.freePush ?? false,
            nextGoldenPayoutMinor: s.nextGoldenPayoutMinor ?? '0',
            beforeKeyMinor: s.beforeKeyMinor,
            lastKey: s.lastKey ?? null,
            boostNumerator: s.boostNumerator ?? 1,
            boostDenominator: s.boostDenominator ?? 1,
            phase: s.phase,
            stage: s.stage,
            items: [...s.items],
            offerMinor: s.offerMinor,
            nextPayoutMinor: s.nextPayoutMinor,
            nextChanceNumerator: s.nextChanceNumerator,
            nextChanceDenominator: s.nextChanceDenominator,
          }))(state as ChestData)
        : r.game === 'forest'
          ? ((s: ForestData) => ({
              phase: s.phase,
              finding: s.finding,
              mode: s.mode,
              keyMultiplier: s.keyMultiplier,
              offerMinor: s.offerMinor,
              crystalAwardMinor: s.crystalAwardMinor,
              target: s.target,
              lastSpin: s.lastSpin ? { kind: s.lastSpin.kind, angle: s.lastSpin.angle } : null,
              message: s.message,
            }))(state as ForestData)
          : ((s: CachesData) => ({
              phase: s.phase,
              found: s.found,
              current: s.current,
              opened: s.opened.map((c) => ({
                index: c.index,
                result: c.result,
                rank: c.rank,
                payoutMinor: c.payoutMinor,
              })),
              ...(!r.active && (s.phase === 'won' || s.phase === 'lost')
                ? {
                    revealed: Array.from({ length: 6 }, (_, index) => ({
                      index,
                      result:
                        r.secret.mask! & (1 << index) ? ('treasure' as const) : ('empty' as const),
                    })),
                  }
                : {}),
              offerMinor: s.offerMinor,
              nextPayoutMinor: s.nextPayoutMinor,
              nextChance: s.nextChance,
            }))(state as CachesData)

    return {
      roundId: r.id,
      game: r.game,
      stakeMinor: r.stake,
      version: r.version,
      active: r.active,
      rulesVersion: r.rules_version,
      payoutMinor: r.payout,
      data,
    }
  }

  private async view(
    user: string,
    game: OriginalGame,
    t: Transaction,
    id?: string,
  ): Promise<OriginalState> {
    const rows = await OriginalRoundsModel.findAll({
      where: { user_id: user, game: game },
      order: [
        ['created_at', 'DESC'],
        ['id', 'DESC'],
      ],
      limit: 8,
      transaction: t,
      raw: true,
    })

    let round = rows.find((r) => r.active) ?? rows[0]

    if (id) {
      const selected = await OriginalRoundsModel.findOne({
        where: { id: id, user_id: user, game: game },
        transaction: t,
        raw: true,
      })

      if (!selected) {
        throw new DiceError('ROUND_NOT_FOUND', 'Раунд не найден.')
      }

      round = selected
    }

    const wallet = await DiceWallet.findOne({
      rejectOnEmpty: true,
      attributes: ['balance', 'version'],
      where: { userId: user },
      transaction: t,
      raw: true,
    })

    const progress = await OriginalProgressModel.findOne({
      attributes: ['crystals', 'crystal_bonus'],
      where: { user_id: user },
      transaction: t,
      raw: true,
    })

    return {
      bonusGrants: await this.account.bonuses.grants(user, t),
      balanceMinor: wallet.balance,
      walletVersion: wallet.version,
      round: round ? this.present(round) : null,
      history: rows.filter((r) => !r.active).map((r) => this.present(r)),
      crystals: progress?.crystals ?? 0,
      crystalBonusMinor: progress?.crystal_bonus ?? '0',
    }
  }

  private async settle(r: Round, amount: string, t: Transaction) {
    r.active = false
    r.payout = amount

    if (
      BigInt(amount) > 0n &&
      !(
        r.game === 'chest' &&
        ['chest-4', 'chest-5'].includes(r.rules_version) &&
        (r.state as ChestData).freePush
      )
    ) {
      await this.account.money(r.user_id, r.id, amount, 'PAYOUT', t, 'original')
    }
  }

  private async save(r: Round, t: Transaction) {
    await OriginalRoundsModel.update(
      { active: r.active, version: r.version, state: r.state, payout: r.payout },
      { where: { id: r.id }, transaction: t },
    )
  }

  private async forest(r: Round, event: OriginalsEvent, input: CommandDto, t: Transaction) {
    const s = r.state as ForestData

    if (event === 'forest.start') {
      const index = this.random.outer()

      const finding = FOREST_SECTORS[index]

      s.mode = 'outer'
      s.lastSpin = { kind: 'outer', angle: (index * TAU) / 16 }
      s.finding = finding

      if (finding === 'key') {
        s.phase = 'key'
        s.message = 'Ключ найден! Открой сердце или заряди ключ.'
      } else if (finding === 'coin') {
        s.phase = 'coin'
        s.offerMinor = forestPay(r.stake, 14n, 10n)
        s.message = 'Забери находку или испытай удачу.'
      } else {
        s.phase = 'settled'

        let award = '0'

        const wheelFree = await Promise.all([
          BonusRoundsModel.findByPk(r.id, { transaction: t }),
          BonusBetsModel.findByPk(r.id, { transaction: t }),
        ]).then((rounds) => rounds.filter(Boolean))

        if (finding === 'crystal' && wheelFree.length) {
          award = forestPay(r.stake, 1n, 2n)
          s.message = 'Выигрыш бесплатного раунда — на бонусном балансе.'
        } else if (finding === 'crystal') {
          await OriginalProgressModel.findOrCreate({
            where: { user_id: r.user_id },
            defaults: { user_id: r.user_id },
            transaction: t,
          })

          const progress = await OriginalProgressModel.findOne({
            rejectOnEmpty: true,
            attributes: ['crystals', 'crystal_bonus'],
            where: { user_id: r.user_id },
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
            raw: true,
          })

          const count = progress.crystals + 1

          const bank = BigInt(progress.crystal_bonus) + BigInt(r.stake) / 20n

          const bonus = count % 5 === 0 ? (bank / 100n) * 100n : 0n

          await OriginalProgressModel.update(
            { crystals: count, crystal_bonus: (bank - bonus).toString() },
            { where: { user_id: r.user_id }, transaction: t },
          )
          s.crystalAwardMinor = bonus.toString()
          award = (BigInt(forestPay(r.stake, 1n, 2n)) + bonus).toString()
          s.message = 'Кристалл в печати. Выплата зачислена.'
        } else {
          s.message = 'Банкрот. Ставка проиграна.'
        }

        s.offerMinor = award
        await this.settle(r, award, t)
      }
    } else if (event === 'forest.open') {
      if (s.phase !== 'key') {
        throw new DiceError('INVALID_PHASE', 'Ключ недоступен.')
      }

      s.phase = 'choose'
      s.mode = 'inner'
      s.lastSpin = null
      s.message = 'Выбери символ сердца. Шанс — 1 из 3.'
    } else if (event === 'forest.charge') {
      if (s.phase !== 'key') {
        throw new DiceError('INVALID_PHASE', 'Ключ недоступен.')
      }

      const won = this.random.risk()

      s.lastSpin = { kind: 'risk', angle: won ? Math.PI / 2 : Math.PI * 1.5 }

      if (won) {
        s.keyMultiplier = 2
        s.phase = 'choose'
        s.mode = 'inner'
        s.message = 'Ключ заряжен! Выбери символ.'
      } else {
        s.phase = 'settled'
        s.mode = 'risk'
        s.finding = 'bankrupt'
        s.message = 'Ключ потерян. Раунд завершён.'
        await this.settle(r, '0', t)
      }
    } else if (event === 'forest.spin') {
      if (s.phase !== 'choose') {
        throw new DiceError('INVALID_PHASE', 'Сначала открой сердце.')
      }

      s.target = (input as ForestSpinDto).target

      const actual = this.random.inner()

      const won = actual === s.target

      s.lastSpin = { kind: 'inner', angle: (actual * TAU) / 3 }
      s.mode = 'inner'
      s.phase = 'settled'
      s.finding = won ? (['star', 'crystal', 'coin'] as const)[s.target] : 'coin'
      s.offerMinor = won
        ? forestPay(r.stake, 9n * BigInt(s.keyMultiplier))
        : forestPay(r.stake, BigInt(s.keyMultiplier), 4n)
      s.message = won
        ? 'Главный приз твой! Приз зачислен.'
        : 'Символ не совпал. Небольшая выплата зачислена.'
      await this.settle(r, s.offerMinor, t)
    } else if (event === 'forest.risk') {
      if (s.phase !== 'coin') {
        throw new DiceError('INVALID_PHASE', 'Риск недоступен.')
      }

      const won = this.random.risk()

      s.lastSpin = { kind: 'risk', angle: won ? Math.PI / 2 : Math.PI * 1.5 }
      s.mode = 'risk'
      s.phase = 'settled'
      s.finding = won ? 'coin' : 'bankrupt'
      s.offerMinor = won ? (BigInt(s.offerMinor) * 2n).toString() : '0'
      s.message = won ? 'Находка удвоена и зачислена.' : 'Находка потеряна.'
      await this.settle(r, s.offerMinor, t)
    } else if (event === 'forest.cashout') {
      if (s.phase !== 'coin') {
        throw new DiceError('CASHOUT_NOT_AVAILABLE', 'Выплата недоступна.')
      }

      s.phase = 'settled'
      s.message = 'Находка зачислена.'
      await this.settle(r, s.offerMinor, t)
    } else {
      throw new DiceError('VALIDATION_ERROR', 'Неизвестное действие.')
    }
  }

  private async caches(r: Round, event: OriginalsEvent, input: CommandDto, t: Transaction) {
    const s = r.state as CachesData

    if (event === 'caches.cashout') {
      if (s.phase !== 'offer') {
        throw new DiceError('CASHOUT_NOT_AVAILABLE', 'Сначала найди сокровище.')
      }

      s.phase = 'won'
      await this.settle(r, s.offerMinor, t)

      return
    }

    const index = (input as CacheRevealDto | CacheStartDto).cardIndex

    if (s.opened.some((c) => c.index === index)) {
      throw new DiceError('CELL_ALREADY_OPENED', 'Карта уже открыта.')
    }

    const treasure = Boolean(r.secret.mask! & (1 << index))

    s.current = index

    if (treasure) {
      s.found++
      s.offerMinor = cachePay(r.stake, s.found)
      s.phase = 'offer'
    } else {
      s.offerMinor = '0'
      s.phase = 'lost'
    }

    s.opened.push({
      index,
      result: treasure ? 'treasure' : 'empty',
      rank: treasure ? s.found : 0,
      payoutMinor: s.offerMinor,
    })
    s.nextPayoutMinor = cachePay(r.stake, Math.min(3, s.found + 1))
    s.nextChance = [50, 40, 25, 0][s.found]

    if (!treasure) {
      await this.settle(r, '0', t)
    } else if (s.found === 3) {
      s.phase = 'won'
      await this.settle(r, s.offerMinor, t)
    }
  }

  private async chest(r: Round, event: OriginalsEvent, t: Transaction) {
    const s = r.state as ChestData

    // Retired demo rounds must never become paid rounds after an upgrade.
    if (s.freePush) {
      throw new DiceError('ROUND_FINISHED', 'Этот раунд больше недоступен.')
    }

    const bonusRules = ['chest-2', 'chest-3', 'chest-4', 'chest-5'].includes(r.rules_version)

    const fixedBonus = r.rules_version === 'chest-3'

    const value = chestFraction(
      BigInt(s.valueNumerator ?? s.offerMinor),
      BigInt(s.valueDenominator ?? '1'),
    )

    const odds = bonusRules ? CHEST_BONUS_ODDS : CHEST_ODDS

    s.lastKey = null
    s.beforeKeyMinor = undefined

    if (event === 'chest.cashout') {
      if (s.phase !== 'offer' || s.stage < 1) {
        throw new DiceError('CASHOUT_NOT_AVAILABLE', 'Сначала открой сундук.')
      }

      s.phase = 'won'
      await this.settle(r, s.offerMinor, t)

      return
    }

    if (['chest-4', 'chest-5'].includes(r.rules_version)) {
      const v5 = r.rules_version === 'chest-5'

      const lastStage = v5 ? 7 : 5

      const valueAt = v5 ? chestV5Value : chestV4Value

      const survival = v5 ? CHEST_V5_SURVIVAL : CHEST_V4_SURVIVAL

      if (s.stage >= lastStage) {
        throw new DiceError('ROUND_FINISHED', 'Все находки открыты. Забери содержимое.')
      }

      const result = (v5 ? calculateV5Outcome : calculateSpinOutcome)(
        r.stake,
        value,
        s.stage,
        (n) => this.random.weighted(n),
      )

      if (result.closed) {
        s.phase = 'lost'
        s.offerMinor = '0'
        s.nextPayoutMinor = '0'
        s.nextGoldenPayoutMinor = '0'
        s.nextChanceNumerator = 0
        await this.settle(r, '0', t)

        return
      }

      s.stage++
      s.items.push(CHEST_ITEMS[(s.stage - 1) % CHEST_ITEMS.length])
      s.lastKey = result.key
      s.beforeKeyMinor = (result.base.n / result.base.d).toString()
      s.valueNumerator = result.value.n.toString()
      s.valueDenominator = result.value.d.toString()
      s.offerMinor = (result.value.n / result.value.d).toString()

      const next =
        s.stage < lastStage ? valueAt(r.stake, s.stage + 1, result.value) : chestFraction(0n)

      const gold =
        s.stage < lastStage
          ? valueAt(r.stake, s.stage + 1, result.value, 'gold')
          : chestFraction(0n)

      s.nextPayoutMinor = (next.n / next.d).toString()
      s.nextGoldenPayoutMinor = (gold.n / gold.d).toString()
      s.nextChanceNumerator = survival[s.stage] ?? 0
      s.nextChanceDenominator = 100

      return
    }

    if (s.stage >= CHEST_ODDS.length) {
      throw new DiceError('ROUND_FINISHED', 'Все находки уже собраны.')
    }

    const [numerator, denominator] = fixedBonus
      ? chestV3Odds(r.stake, s.stage, value)
      : odds[s.stage]

    const success = s.stage === 0 || this.random.weighted(BigInt(denominator)) < BigInt(numerator)

    if (!success) {
      s.phase = 'lost'
      s.offerMinor = '0'
      s.nextPayoutMinor = '0'
      s.nextChanceNumerator = 0
      await this.settle(r, '0', t)

      return
    }

    s.stage++
    s.items.push(CHEST_ITEMS[(s.stage - 1) % CHEST_ITEMS.length])

    if (bonusRules) {
      const base = fixedBonus ? chestV3Value(r.stake, s.stage, value) : null

      s.beforeKeyMinor = base
        ? (base.n / base.d).toString()
        : chestBoostedPay(r.stake, s.stage, s.boostNumerator, s.boostDenominator)
      s.lastKey = chestKey(this.random.weighted(200n))

      if (s.lastKey && !fixedBonus) {
        s.boostNumerator = (s.boostNumerator ?? 1) * (s.lastKey === 'gold' ? 2 : 3)
        s.boostDenominator = (s.boostDenominator ?? 1) * (s.lastKey === 'gold' ? 1 : 2)
      }
    }

    if (fixedBonus) {
      const updated = chestV3Value(r.stake, s.stage, value, s.lastKey)

      s.valueNumerator = updated.n.toString()
      s.valueDenominator = updated.d.toString()
      s.offerMinor = (updated.n / updated.d).toString()

      const hasNext = s.stage < 7

      const nextValue = hasNext ? chestV3Value(r.stake, s.stage + 1, updated) : chestFraction(0n)

      const goldValue = hasNext
        ? chestV3Value(r.stake, s.stage + 1, updated, 'gold')
        : chestFraction(0n)

      s.nextPayoutMinor = (nextValue.n / nextValue.d).toString()
      s.nextGoldenPayoutMinor = (goldValue.n / goldValue.d).toString()
      ;[s.nextChanceNumerator, s.nextChanceDenominator] = chestV3Odds(r.stake, s.stage, updated)

      if (!hasNext) {
        s.phase = 'won'
        await this.settle(r, s.offerMinor, t)
      }

      return
    }

    s.offerMinor = chestBoostedPay(r.stake, s.stage, s.boostNumerator, s.boostDenominator)

    const next = odds[s.stage]

    s.nextPayoutMinor = next
      ? chestBoostedPay(r.stake, s.stage + 1, s.boostNumerator, s.boostDenominator)
      : '0'
    s.nextGoldenPayoutMinor =
      next && bonusRules
        ? chestBoostedPay(r.stake, s.stage + 1, (s.boostNumerator ?? 1) * 2, s.boostDenominator)
        : '0'
    s.nextChanceNumerator = next?.[0] ?? 0
    s.nextChanceDenominator = next?.[1] ?? 1

    if (!next) {
      s.phase = 'won'
      await this.settle(r, s.offerMinor, t)
    }
  }

  async command(
    identity: Identity,
    event: OriginalsEvent,
    input: CommandDto,
  ): Promise<OriginalsReply> {
    return this.account.db.transaction(async (t) => {
      await this.repository.setLockTimeout(t)
      await this.repository.setStatementTimeout(t)

      const who = await this.account.session(identity.sessionHash, t)

      if (who.userId !== identity.userId) {
        throw new DiceError('UNAUTHENTICATED', 'Войди заново.')
      }

      const user = who.userId

      await this.repository.lockAccount({ user }, t)

      const payloadHash = digest(
        JSON.stringify([event, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))]),
      )

      const old = await OriginalCommandsModel.findOne({
        attributes: ['payload_hash', 'response'],
        where: { user_id: user, request_id: input.requestId },
        transaction: t,
        raw: true,
      })

      if (old) {
        if (old.payload_hash !== payloadHash) {
          throw new DiceError('IDEMPOTENCY_CONFLICT', 'ID уже использован для другого действия.')
        }

        return old.response
      }

      const wallet = await this.account.wallet(user, t)

      if (event.endsWith('.commandStatus')) {
        const saved = await OriginalCommandsModel.findOne({
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

      const game = event.split('.')[0] as OriginalGame | 'jackpots'

      if (event.endsWith('.sync')) {
        return {
          ok: true,
          requestId: input.requestId,
          data:
            game === 'jackpots'
              ? await this.jackpots.view(user, t, (input as JackpotSyncDto).drawId)
              : await this.view(user, game, t, (input as SyncDto).roundId),
        }
      }

      let response: OriginalsReply

      if (game === 'jackpots') {
        response = {
          ok: true,
          requestId: input.requestId,
          data: await this.jackpots.action(user, event, input as DrawDto, t),
        }
      } else {
        let r: Round

        if (event.endsWith('.start')) {
          if (
            (
              await OriginalRoundsModel.findAll({
                attributes: ['id'],
                where: { user_id: user, game: game, active: true },
                transaction: t,
                raw: true,
              })
            ).length
          ) {
            throw new DiceError('ACTIVE_ROUND_EXISTS', 'Заверши текущий раунд.')
          }

          const stake = (input as ForestStartDto).stakeMinor

          const bonusId = (input as ForestStartDto).bonusGrantId

          const bonusWalletId = (input as ForestStartDto).bonusWalletId

          if (bonusId && bonusWalletId) {
            throw new DiceError('VALIDATION_ERROR', 'Выбери один источник ставки.')
          }

          if (BigInt(stake) < 1000n || BigInt(stake) > 10000000n || BigInt(stake) % 100n !== 0n) {
            throw new DiceError('VALIDATION_ERROR', 'Ставка от 10 до 100 000 целых фишек.')
          }

          if (!bonusId && !bonusWalletId && BigInt(wallet.balance) < BigInt(stake)) {
            throw new DiceError('INSUFFICIENT_FUNDS', 'Недостаточно фишек.')
          }

          const state: ForestData | CachesData | ChestData =
            game === 'chest'
              ? {
                  lastKey: null,
                  boostNumerator: 1,
                  boostDenominator: 1,
                  phase: 'offer',
                  stage: 0,
                  items: [],
                  offerMinor: '0',
                  nextPayoutMinor: chestPay(stake, 1),
                  nextChanceNumerator: 1,
                  nextChanceDenominator: 1,
                }
              : game === 'forest'
                ? {
                    phase: 'settled',
                    finding: 'bankrupt',
                    mode: 'outer',
                    keyMultiplier: 1,
                    offerMinor: '0',
                    crystalAwardMinor: '0',
                    target: 0,
                    lastSpin: null,
                    message: '',
                  }
                : {
                    phase: 'choose',
                    found: 0,
                    current: -1,
                    opened: [],
                    offerMinor: '0',
                    nextPayoutMinor: cachePay(stake, 1),
                    nextChance: 50,
                  }

          r = {
            id: randomUUID(),
            user_id: user,
            game,
            stake,
            active: true,
            version: 1,
            rules_version:
              game === 'forest' ? 'forest-1' : game === 'chest' ? 'chest-5' : 'caches-network-1',
            state,
            secret: game === 'caches' ? { mask: this.random.deck() } : {},
            payout: '0',
          }
          await OriginalRoundsModel.create(
            {
              id: r.id,
              user_id: user,
              game,
              stake,
              active: true,
              rules_version: r.rules_version,
              state,
              secret: r.secret,
            },
            { transaction: t },
          )

          if (bonusId) {
            await this.account.bonuses.consume(user, bonusId, game, stake, r.id, 'original', t)
          }

          if (bonusWalletId) {
            await this.account.bonuses.consumeBalance(user, bonusWalletId, stake, r.id, t)
          }

          if (!bonusId && !bonusWalletId) {
            await this.account.money(
              user,
              r.id,
              (-BigInt(stake)).toString(),
              'STAKE',
              t,
              'original',
            )
          }

          if (game === 'caches' && !bonusId && !bonusWalletId) {
            await this.jackpots.contribute(user, r.id, stake, t)
          }
        } else {
          const dto = input as RoundDto

          const row = await OriginalRoundsModel.findOne({
            where: { user_id: user, game: game, id: dto.roundId },
            transaction: t,
            lock: Transaction.LOCK.UPDATE,
            raw: true,
          })

          if (!row) {
            throw new DiceError('ROUND_NOT_FOUND', 'Раунд не найден.')
          }

          if (!row.active) {
            throw new DiceError('ROUND_FINISHED', 'Раунд завершён.')
          }

          if (row.version !== dto.expectedVersion) {
            throw new DiceError('VERSION_CONFLICT', 'Раунд изменился. Обновляем состояние.')
          }

          if (
            !(
              game === 'chest'
                ? ['chest-1', 'chest-2', 'chest-3', 'chest-4', 'chest-5']
                : [game === 'forest' ? 'forest-1' : 'caches-network-1']
            ).includes(row.rules_version)
          ) {
            throw new DiceError('TEMPORARILY_UNAVAILABLE', 'Версия правил недоступна.', true)
          }

          r = row
          r.version++
        }

        if (game === 'forest') {
          await this.forest(r, event, input, t)
        } else if (game === 'chest') {
          await this.chest(r, event, t)
        } else {
          await this.caches(r, event, input, t)
        }

        await this.save(r, t)

        if (!r.active) {
          await this.account.bonuses.settled(user, r.id, 'original', t)
        }

        const data = await this.view(user, game, t, r.id)

        if (event === 'caches.reveal' && data.round?.active) {
          const cache = data.round.data as CachesData

          cache.opened = cache.opened.filter((c) => c.index === (input as CacheRevealDto).cardIndex)
        }

        response = { ok: true, requestId: input.requestId, data }
      }

      await OriginalCommandsModel.create(
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

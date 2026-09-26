import { OriginalsService } from '../games/originals.service.js'
import { NetworkJackpotsService } from '../games/network-jackpots.service.js'
import {
  ForestStartDto,
  ChestStartDto,
  CacheStartDto,
  CacheRevealDto,
  ForestSpinDto,
  DrawDto,
  DrawRevealDto,
  JackpotSyncDto,
} from '../games/dto.js'
import type { OriginalsEvent, OriginalsReply } from '../games/contracts.js'
import type { OnModuleDestroy } from '@nestjs/common'
import { Inject, Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
  type OnGatewayDisconnect,
  type OnGatewayConnection,
} from '@nestjs/websockets'
import type { Namespace, Socket } from 'socket.io'
import { plainToInstance } from 'class-transformer'
import { validate, isUUID } from 'class-validator'
import { DiceService, type Identity } from './dice.service.js'
import type { CommandDto } from './dto.js'
import { StartDto, RevealDto, RoundDto, SyncDto, StatusDto } from './dto.js'
import { DiceError } from './errors.js'
import type { DiceEvent, DiceReply } from './contracts.js'

type Client = Socket & {
  data: {
    identity?: Identity
    pending?: boolean
    burst?: { count: number; at: number }
  }
}

@WebSocketGateway({
  namespace: '/dice',
  allowRequest: (
    request: { headers: { origin?: string } },
    callback: (error: string | null, allowed: boolean) => void,
  ) => {
    const origins = (
      process.env.DICE_WS_ORIGINS ??
      'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3100'
    )
      .split(',')
      .map((s) => s.trim())

    callback(null, Boolean(request.headers.origin && origins.includes(request.headers.origin)))
  },
  transports: ['websocket'],
  maxHttpBufferSize: 4096,
  perMessageDeflate: false,
  pingInterval: 25000,
  pingTimeout: 20000,
})
export class DiceGateway
  implements OnGatewayInit, OnGatewayDisconnect, OnGatewayConnection, OnModuleDestroy
{
  @WebSocketServer() server!: Namespace
  private timer?: ReturnType<typeof setInterval>
  private notifyTimer?: ReturnType<typeof setInterval>
  private notifying = false
  private logger = new Logger(DiceGateway.name)
  constructor(
    @Inject(DiceService) private readonly dice: DiceService,
    @Inject(OriginalsService) private readonly originals: OriginalsService,
    @Inject(NetworkJackpotsService)
    private readonly jackpots: NetworkJackpotsService,
  ) {}
  afterInit(server: Namespace) {
    const origins = (
      process.env.DICE_WS_ORIGINS ??
      'http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3100'
    )
      .split(',')
      .map((s) => s.trim())

    if (process.env.NODE_ENV === 'production' && !process.env.DICE_WS_ORIGINS) {
      throw new Error('DICE_WS_ORIGINS required in production')
    }

    for (const origin of origins) {
      const url = new URL(origin)

      if (
        url.origin !== origin ||
        !['http:', 'https:'].includes(url.protocol) ||
        (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
      ) {
        throw new Error('Invalid DICE_WS_ORIGINS')
      }
    }

    const handshakeLimit = Number(process.env.DICE_WS_HANDSHAKES_PER_MIN ?? 30)

    if (!Number.isInteger(handshakeLimit) || handshakeLimit < 1 || handshakeLimit > 10000) {
      throw new Error('Invalid DICE_WS_HANDSHAKES_PER_MIN')
    }

    server.use((client: Client, next) => {
      void (async () => {
        if (
          !client.handshake.headers.origin ||
          !origins.includes(client.handshake.headers.origin)
        ) {
          throw new DiceError('UNAUTHENTICATED', 'Origin rejected')
        }

        await this.dice.limit('handshake:' + client.handshake.address, handshakeLimit, 60)
        client.data.identity = await this.dice.connect(client.handshake.auth?.ticket, client.id)
        next()
      })().catch(() => next(new Error('CONNECTION_REJECTED')))
    })
    this.timer = setInterval(() => {
      void this.maintain(server)
    }, 30000)
    this.timer.unref()
    this.notifyTimer = setInterval(() => {
      if (this.notifying) {
        return
      }

      this.notifying = true
      void this.jackpots
        .notifications((eventId) => server.emit('jackpots.changed', { eventId }))
        .catch(() => this.logger.warn('Jackpot notifications deferred'))
        .finally(() => {
          this.notifying = false
        })
    }, 2000)
    this.notifyTimer.unref()
  }
  handleConnection(client: Client) {
    const events = new Set([
      'dice.start',
      'dice.reveal',
      'dice.cashout',
      'dice.sync',
      'dice.commandStatus',
      'forest.start',
      'forest.open',
      'forest.charge',
      'forest.spin',
      'forest.risk',
      'forest.cashout',
      'forest.sync',
      'forest.commandStatus',
      'chest.start',
      'chest.open',
      'chest.cashout',
      'chest.sync',
      'chest.commandStatus',
      'caches.start',
      'caches.reveal',
      'caches.cashout',
      'caches.sync',
      'caches.commandStatus',
      'jackpots.sync',
      'jackpots.reveal',
      'jackpots.claim',
      'jackpots.commandStatus',
    ])

    client.onAny((event: string) => {
      if (!events.has(event)) {
        client.disconnect(true)
      }
    })
  }
  private async maintain(server: Namespace) {
    await Promise.all(
      [...server.sockets.values()].map(async (client: Client) => {
        try {
          if (client.data.identity) {
            await this.dice.heartbeat(client.id, client.data.identity)
          }
        } catch {
          client.disconnect(true)
        }
      }),
    )

    try {
      await this.dice.cleanup()
    } catch {
      this.logger.warn('Dice cleanup unavailable')
    }
  }
  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
    }

    if (this.notifyTimer) {
      clearInterval(this.notifyTimer)
    }
  }
  async handleDisconnect(client: Client) {
    try {
      await this.dice.disconnect(client.id)
    } catch {
      this.logger.warn('Dice lease cleanup deferred')
    }
  }
  private async run(
    client: Client,
    event: DiceEvent | OriginalsEvent,
    payload: unknown,
  ): Promise<DiceReply | OriginalsReply> {
    const requestId =
      payload &&
      typeof payload === 'object' &&
      'requestId' in payload &&
      isUUID(payload.requestId, '4')
        ? String(payload.requestId)
        : null

    let acquired = false

    try {
      if (!client.data.identity) {
        throw new DiceError('UNAUTHENTICATED', 'Войди в аккаунт.')
      }

      const now = Date.now()

      const burst = client.data.burst

      client.data.burst =
        burst && now - burst.at < 1000
          ? { at: burst.at, count: burst.count + 1 }
          : { at: now, count: 1 }

      if (client.data.burst.count > 15) {
        client.disconnect(true)
        throw new DiceError('RATE_LIMITED', 'Слишком много команд.', true)
      }

      if (client.data.pending) {
        throw new DiceError('RATE_LIMITED', 'Дождись ответа на предыдущее действие.', true)
      }

      client.data.pending = true
      acquired = true
      await this.dice.limit('commands:' + client.data.identity.userId, 15, 1)

      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.getPrototypeOf(payload) !== Object.prototype
      ) {
        throw new DiceError('VALIDATION_ERROR', 'Неверный формат команды.')
      }

      const classes: Record<DiceEvent | OriginalsEvent, new () => CommandDto> = {
        'forest.start': ForestStartDto,
        'forest.open': RoundDto,
        'forest.charge': RoundDto,
        'forest.spin': ForestSpinDto,
        'forest.risk': RoundDto,
        'forest.cashout': RoundDto,
        'forest.sync': SyncDto,
        'forest.commandStatus': StatusDto,
        'chest.start': ChestStartDto,
        'chest.open': RoundDto,
        'chest.cashout': RoundDto,
        'chest.sync': SyncDto,
        'chest.commandStatus': StatusDto,
        'caches.start': CacheStartDto,
        'caches.reveal': CacheRevealDto,
        'caches.cashout': RoundDto,
        'caches.sync': SyncDto,
        'caches.commandStatus': StatusDto,
        'jackpots.sync': JackpotSyncDto,
        'jackpots.reveal': DrawRevealDto,
        'jackpots.claim': DrawDto,
        'jackpots.commandStatus': StatusDto,
        'dice.start': StartDto,
        'dice.reveal': RevealDto,
        'dice.cashout': RoundDto,
        'dice.sync': SyncDto,
        'dice.commandStatus': StatusDto,
      }

      const dto = plainToInstance(classes[event], payload, {
        enableImplicitConversion: false,
      })

      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
        validationError: { target: false, value: false },
      })

      if (errors.length) {
        throw new DiceError('VALIDATION_ERROR', 'Проверь параметры действия.')
      }

      return event.startsWith('dice.')
        ? await this.dice.command(client.data.identity, event as DiceEvent, dto)
        : await this.originals.command(client.data.identity, event as OriginalsEvent, dto)
    } catch (error) {
      const known = error instanceof DiceError

      if (!known) {
        this.logger.error(JSON.stringify({ event, requestId, code: 'TRANSACTION_FAILED' }))
      }

      return {
        ok: false,
        requestId,
        error: {
          code: known ? error.code : 'TEMPORARILY_UNAVAILABLE',
          message: known ? error.message : 'Сервис временно недоступен. Восстанови состояние.',
          retryable: known ? error.retryable : true,
        },
      }
    } finally {
      if (acquired) {
        client.data.pending = false
      }
    }
  }
  @SubscribeMessage('dice.start') start(@ConnectedSocket() c: Client, @MessageBody() p: unknown) {
    return this.run(c, 'dice.start', p)
  }
  @SubscribeMessage('dice.reveal') reveal(@ConnectedSocket() c: Client, @MessageBody() p: unknown) {
    return this.run(c, 'dice.reveal', p)
  }
  @SubscribeMessage('dice.cashout') cashout(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'dice.cashout', p)
  }
  @SubscribeMessage('dice.sync') sync(@ConnectedSocket() c: Client, @MessageBody() p: unknown) {
    return this.run(c, 'dice.sync', p)
  }
  @SubscribeMessage('dice.commandStatus') status(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'dice.commandStatus', p)
  }
  @SubscribeMessage('forest.start') original0(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.start', p)
  }
  @SubscribeMessage('forest.open') original1(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.open', p)
  }
  @SubscribeMessage('forest.charge') original2(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.charge', p)
  }
  @SubscribeMessage('forest.spin') original3(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.spin', p)
  }
  @SubscribeMessage('forest.risk') original4(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.risk', p)
  }
  @SubscribeMessage('forest.cashout') original5(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.cashout', p)
  }
  @SubscribeMessage('forest.sync') original6(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.sync', p)
  }
  @SubscribeMessage('forest.commandStatus') original7(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'forest.commandStatus', p)
  }
  @SubscribeMessage('chest.start') chest0(@ConnectedSocket() c: Socket, @MessageBody() p: unknown) {
    return this.run(c, 'chest.start', p)
  }
  @SubscribeMessage('chest.open') chest1(@ConnectedSocket() c: Socket, @MessageBody() p: unknown) {
    return this.run(c, 'chest.open', p)
  }
  @SubscribeMessage('chest.cashout') chest2(
    @ConnectedSocket() c: Socket,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'chest.cashout', p)
  }
  @SubscribeMessage('chest.sync') chest3(@ConnectedSocket() c: Socket, @MessageBody() p: unknown) {
    return this.run(c, 'chest.sync', p)
  }
  @SubscribeMessage('chest.commandStatus') chest4(
    @ConnectedSocket() c: Socket,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'chest.commandStatus', p)
  }
  @SubscribeMessage('caches.start') original8(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'caches.start', p)
  }
  @SubscribeMessage('caches.reveal') original9(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'caches.reveal', p)
  }
  @SubscribeMessage('caches.cashout') original10(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'caches.cashout', p)
  }
  @SubscribeMessage('caches.sync') original11(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'caches.sync', p)
  }
  @SubscribeMessage('caches.commandStatus') original12(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'caches.commandStatus', p)
  }
  @SubscribeMessage('jackpots.sync') original13(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'jackpots.sync', p)
  }
  @SubscribeMessage('jackpots.reveal') original14(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'jackpots.reveal', p)
  }
  @SubscribeMessage('jackpots.claim') original15(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'jackpots.claim', p)
  }
  @SubscribeMessage('jackpots.commandStatus') original16(
    @ConnectedSocket() c: Client,
    @MessageBody() p: unknown,
  ) {
    return this.run(c, 'jackpots.commandStatus', p)
  }
}

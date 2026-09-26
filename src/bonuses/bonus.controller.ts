import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { IsIn, IsUUID } from 'class-validator'
import { BonusService, guestDigest } from './bonus.service.js'

class SpinDto {
  @IsIn(['welcome', 'weekly']) mode!: 'welcome' | 'weekly'
}

class ClaimDto {
  @IsUUID('4') id!: string
}

@Controller('bonuses')
export class BonusController {
  constructor(@Inject(BonusService) private readonly bonus: BonusService) {}
  private async identity(auth?: string) {
    if (!auth) {
      return null
    }

    if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth)) {
      throw new UnauthorizedException()
    }

    const [s] = await this.bonus.rows<{ userId: string }>(
      'SELECT "userId" FROM auth_sessions WHERE hash=:hash AND "expiresAt">NOW()',
      { hash: guestDigest(auth.slice(7)) },
    )

    if (!s) {
      throw new UnauthorizedException()
    }

    return s.userId
  }
  private guest(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException()
    }

    return guestDigest(token)
  }
  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(@Headers('authorization') auth?: string, @Headers('x-bonus-guest') guest?: string) {
    return this.bonus.status(await this.identity(auth), this.guest(guest))
  }
  @Post('spin')
  @Header('Cache-Control', 'no-store')
  async spin(
    @Body() body: SpinDto,
    @Headers('authorization') auth?: string,
    @Headers('x-bonus-guest') guest?: string,
  ) {
    return this.bonus.spin(await this.identity(auth), this.guest(guest), body.mode)
  }
  @Post('claim')
  @Header('Cache-Control', 'no-store')
  async claim(@Body() body: ClaimDto, @Headers('authorization') auth?: string) {
    const user = await this.identity(auth)

    if (!user) {
      throw new UnauthorizedException()
    }

    await this.bonus.claim(user, body.id)

    return { ok: true }
  }
}

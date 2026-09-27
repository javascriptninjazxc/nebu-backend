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
import { ClaimDto, SpinDto } from './bonus.dto.js'
import { BonusService } from './bonus.service.js'
import { guestDigest } from './bonus.utils.js'

@Controller('bonuses')
export class BonusController {
  constructor(@Inject(BonusService) private readonly bonus: BonusService) {}

  private guest(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new UnauthorizedException()
    }

    return guestDigest(token)
  }

  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(@Headers('authorization') auth?: string, @Headers('x-bonus-guest') guest?: string) {
    return this.bonus.status(await this.bonus.identity(auth), this.guest(guest))
  }

  @Post('spin')
  @Header('Cache-Control', 'no-store')
  async spin(
    @Body() body: SpinDto,
    @Headers('authorization') auth?: string,
    @Headers('x-bonus-guest') guest?: string,
  ) {
    return this.bonus.spin(await this.bonus.identity(auth), this.guest(guest), body.mode)
  }

  @Post('claim')
  @Header('Cache-Control', 'no-store')
  async claim(@Body() body: ClaimDto, @Headers('authorization') auth?: string) {
    const user = await this.bonus.identity(auth)

    if (!user) {
      throw new UnauthorizedException()
    }

    await this.bonus.claim(user, body.id)

    return { ok: true }
  }
}

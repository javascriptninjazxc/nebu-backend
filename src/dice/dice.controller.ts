import {
  Controller,
  Header,
  Headers,
  HttpException,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { DiceService } from './dice.service.js'
import { DiceError } from './errors.js'

@Controller('auth')
export class DiceController {
  constructor(@Inject(DiceService) private readonly dice: DiceService) {}
  @Post('ws-ticket')
  @Header('Cache-Control', 'no-store')
  async ticket(@Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException()
    }

    try {
      return await this.dice.ticket(authorization.slice(7))
    } catch (error) {
      if (error instanceof DiceError && error.code === 'UNAUTHENTICATED') {
        throw new UnauthorizedException()
      }

      if (error instanceof DiceError && error.code === 'RATE_LIMITED') {
        throw new HttpException(error.message, 429)
      }

      throw error
    }
  }
}

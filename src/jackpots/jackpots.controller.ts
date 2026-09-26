import { Controller, Get, Inject } from '@nestjs/common'
import { JackpotsService } from './jackpots.service.js'

@Controller('jackpots')
export class JackpotsController {
  constructor(@Inject(JackpotsService) private readonly jackpots: JackpotsService) {}
  @Get('config')
  configuration() {
    return this.jackpots.getConfiguration()
  }
}

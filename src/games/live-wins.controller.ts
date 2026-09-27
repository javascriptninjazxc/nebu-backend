import { Controller, Get, Header, Inject } from '@nestjs/common'
import { LiveWinsService } from './live-wins.service.js'

@Controller('live-wins')
export class LiveWinsController {
  constructor(@Inject(LiveWinsService) private readonly wins: LiveWinsService) {}

  @Get('players')
  @Header('Cache-Control', 'public, max-age=30')
  players() {
    return this.wins.players()
  }

  @Get()
  @Header('Cache-Control', 'public, max-age=5')
  get() {
    return this.wins.get()
  }
}

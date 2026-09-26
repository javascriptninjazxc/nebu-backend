import { BonusModule } from '../bonuses/bonus.module.js'
import { LiveWinsController } from '../games/live-wins.controller.js'
import { OriginalsService } from '../games/originals.service.js'
import { OriginalsRandom } from '../games/random.js'
import { NetworkJackpotsService } from '../games/network-jackpots.service.js'
import { GameAccountService } from '../games/account.service.js'
import { SequelizeModule } from '@nestjs/sequelize'
import { DiceWallet, DiceEntry } from './models.js'
import { Module } from '@nestjs/common'
import { DiceService } from './dice.service.js'
import { DiceRandom } from './math.js'
import { DiceGateway } from './dice.gateway.js'
import { DiceController } from './dice.controller.js'

@Module({
  imports: [BonusModule, SequelizeModule.forFeature([DiceWallet, DiceEntry])],
  providers: [
    OriginalsService,
    OriginalsRandom,
    NetworkJackpotsService,
    GameAccountService,
    DiceService,
    DiceRandom,
    DiceGateway,
  ],
  controllers: [DiceController, LiveWinsController],
  exports: [DiceService],
})
export class DiceModule {}

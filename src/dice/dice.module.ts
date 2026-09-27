import { Module } from '@nestjs/common'
import { SequelizeModule } from '@nestjs/sequelize'
import { BonusModule } from '../bonuses/bonus.module.js'
import { GameAccountRepository } from '../games/account.repository.js'
import { GameAccountService } from '../games/account.service.js'
import { LiveWinsController } from '../games/live-wins.controller.js'
import { LiveWinsRepository } from '../games/live-wins.repository.js'
import { LiveWinsService } from '../games/live-wins.service.js'
import { NetworkJackpotsRepository } from '../games/network-jackpots.repository.js'
import { NetworkJackpotsService } from '../games/network-jackpots.service.js'
import { OriginalsRepository } from '../games/originals.repository.js'
import { OriginalsService } from '../games/originals.service.js'
import { OriginalsRandom } from '../games/random.js'
import { DiceController } from './dice.controller.js'
import { DiceGateway } from './dice.gateway.js'
import { DiceRepository } from './dice.repository.js'
import { DiceService } from './dice.service.js'
import { DiceRandom } from './math.js'
import { DiceEntry, DiceWallet } from './models.js'

@Module({
  imports: [BonusModule, SequelizeModule.forFeature([DiceWallet, DiceEntry])],
  providers: [
    LiveWinsRepository,
    NetworkJackpotsRepository,
    OriginalsRepository,
    DiceRepository,
    GameAccountRepository,
    LiveWinsService,
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

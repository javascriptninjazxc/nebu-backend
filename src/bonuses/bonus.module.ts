import { Module } from '@nestjs/common'
import { BonusService } from './bonus.service.js'
import { BonusController } from './bonus.controller.js'

@Module({
  providers: [BonusService],
  controllers: [BonusController],
  exports: [BonusService],
})
export class BonusModule {}

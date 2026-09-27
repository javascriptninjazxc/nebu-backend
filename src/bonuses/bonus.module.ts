import { Module } from '@nestjs/common'
import { BonusController } from './bonus.controller.js'
import { BonusRepository } from './bonus.repository.js'
import { BonusService } from './bonus.service.js'

@Module({
  providers: [BonusRepository, BonusService],
  controllers: [BonusController],
  exports: [BonusService],
})
export class BonusModule {}

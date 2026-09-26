import { Module } from '@nestjs/common'
import { JackpotsController } from './jackpots.controller.js'
import { JackpotsService } from './jackpots.service.js'

@Module({ controllers: [JackpotsController], providers: [JackpotsService] })
export class JackpotsModule {}

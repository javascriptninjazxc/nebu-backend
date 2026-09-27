import { Module } from '@nestjs/common'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { AuthModule } from './auth/auth.module.js'
import { DatabaseModule } from './database/database.module.js'
import { DiceModule } from './dice/dice.module.js'
import { JackpotsModule } from './jackpots/jackpots.module.js'

@Module({
  imports: [DatabaseModule, JackpotsModule, AuthModule, DiceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

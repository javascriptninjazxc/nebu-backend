import { BonusModule } from '../bonuses/bonus.module.js'
import { ProfileService } from './profile.service.js'
import { ProfileController } from './profile.controller.js'
import { Module } from '@nestjs/common'
import { SequelizeModule } from '@nestjs/sequelize'
import { User, AuthSession } from './models.js'
import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'

@Module({
  imports: [BonusModule, SequelizeModule.forFeature([User, AuthSession])],
  controllers: [AuthController, ProfileController],
  providers: [AuthService, ProfileService],
})
export class AuthModule {}

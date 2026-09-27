import { Module } from '@nestjs/common'
import { SequelizeModule } from '@nestjs/sequelize'
import { BonusModule } from '../bonuses/bonus.module.js'
import { AuthController } from './auth.controller.js'
import { AuthRepository } from './auth.repository.js'
import { AuthService } from './auth.service.js'
import { AuthSession, User } from './models.js'
import { ProfileController } from './profile.controller.js'
import { ProfileRepository } from './profile.repository.js'
import { ProfileService } from './profile.service.js'

@Module({
  imports: [BonusModule, SequelizeModule.forFeature([User, AuthSession])],
  controllers: [AuthController, ProfileController],
  providers: [AuthRepository, AuthService, ProfileService, ProfileRepository],
})
export class AuthModule {}

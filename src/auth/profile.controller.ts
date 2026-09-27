import { Body, Controller, Get, Header, Headers, Inject, Post, Query } from '@nestjs/common'
import { tokenFrom as token } from './auth-request.utils.js'
import { AuthService } from './auth.service.js'
import { EditProfileDto, PasswordDto } from './profile.dto.js'
import { ProfileService } from './profile.service.js'

@Controller('profile')
export class ProfileController {
  constructor(
    @Inject(ProfileService) private readonly profile: ProfileService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(
    @Headers('authorization') header: string,
    @Query('period') period = '7',
    @Query('game') game = 'all',
    @Query('page') page = '0',
    @Query('ledgerPage') ledgerPage = '0',
  ) {
    return this.profile.get(token(header), period, game, Number(page), Number(ledgerPage))
  }

  @Post('save')
  @Header('Cache-Control', 'no-store')
  save(@Headers('authorization') header: string, @Body() body: EditProfileDto) {
    return this.profile.save(token(header), body.displayName, body.avatar)
  }

  @Post('password')
  @Header('Cache-Control', 'no-store')
  password(@Headers('authorization') header: string, @Body() body: PasswordDto) {
    return this.auth.changePassword(token(header), body.currentPassword, body.newPassword)
  }

  @Post('sessions')
  @Header('Cache-Control', 'no-store')
  sessions(@Headers('authorization') header: string) {
    return this.auth.revokeOtherSessions(token(header))
  }
}

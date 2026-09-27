import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { clientIp, tokenFrom } from './auth-request.utils.js'
import { LoginDto, QuickDto } from './auth.dto.js'
import { AuthService } from './auth.service.js'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('quick')
  @Header('Cache-Control', 'no-store')
  async quick(@Body() body: QuickDto, @Req() request: Request) {
    await this.auth.limit('quick-ip:' + clientIp(request), 10)

    return this.auth.quick(body.promo, request.get('x-bonus-guest'))
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(@Body() body: LoginDto, @Req() request: Request) {
    await this.auth.limit('login-ip:' + clientIp(request), 60)

    return this.auth.login(body.login, body.password)
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  me(@Headers('authorization') header?: string) {
    return this.auth.me(tokenFrom(header))
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  logout(@Headers('authorization') header?: string) {
    return this.auth.logout(tokenFrom(header))
  }
}

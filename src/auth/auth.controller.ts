import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import type { Request } from 'express'
import { AuthService } from './auth.service.js'

export class LoginDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9_]{3,64}$/)
  login!: string
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string
}

export class QuickDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_-]*$/)
  promo?: string
}

function clientIp(request: Request) {
  const secret = process.env.AUTH_PROXY_SECRET

  const provided = request.get('x-auth-proxy-secret')

  const ip = request.get('x-auth-client-ip')

  if (
    secret &&
    provided &&
    Buffer.byteLength(secret) === Buffer.byteLength(provided) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(provided)) &&
    ip &&
    isIP(ip)
  ) {
    return ip
  }

  return request.ip
}

const tokenFrom = (header?: string) => {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new UnauthorizedException()
  }

  return header.slice(7)
}

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

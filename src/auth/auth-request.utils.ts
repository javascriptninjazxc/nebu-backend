import { UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'

export function clientIp(request: Request) {
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

export const tokenFrom = (header?: string) => {
  if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) {
    throw new UnauthorizedException()
  }

  return header.slice(7)
}

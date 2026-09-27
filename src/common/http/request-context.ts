import { Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'

export interface RequestContext {
  requestId: string
}

export function requestContext(
  req: Request,
  res: Response<unknown, RequestContext>,
  next: NextFunction,
): void {
  const incoming = req.get('x-request-id')

  const requestId = incoming && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming) ? incoming : randomUUID()

  res.locals.requestId = requestId
  res.setHeader('x-request-id', requestId)

  const start = performance.now()

  res.on('finish', () => {
    Logger.log(
      {
        event: 'http_request',
        requestId,
        method: req.method,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - start),
      },
      'HTTP',
    )
  })
  next()
}

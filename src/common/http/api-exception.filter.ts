import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Response } from 'express'
import type { RequestContext } from './request-context.js'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response<unknown, RequestContext>>()

    const oversized =
      exception instanceof Error && 'type' in exception && exception.type === 'entity.too.large'

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : oversized
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.INTERNAL_SERVER_ERROR

    let message: string | string[] = oversized ? 'Payload too large' : 'Internal server error'

    if (exception instanceof HttpException && statusCode < 500) {
      const body = exception.getResponse()

      if (typeof body === 'string') {
        message = body
      } else if ('message' in body && typeof body.message === 'string') {
        message = body.message
      } else if (
        'message' in body &&
        Array.isArray(body.message) &&
        body.message.every((item: unknown) => typeof item === 'string')
      ) {
        message = body.message as string[]
      }
    }

    const requestId = response.locals.requestId

    if (statusCode >= 500) {
      Logger.error({ event: 'request_failed', requestId, statusCode }, 'HTTP')
    }

    if (response.headersSent) {
      return
    }

    response.status(statusCode).json({
      statusCode,
      message,
      requestId,
      timestamp: new Date().toISOString(),
    })
  }
}

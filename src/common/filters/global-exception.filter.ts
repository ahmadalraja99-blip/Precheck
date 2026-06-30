import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof exceptionResponse === 'object' && exceptionResponse && 'message' in exceptionResponse
        ? (exceptionResponse as { message: unknown }).message
        : exception instanceof Error
          ? exception.message
          : 'Unexpected server error';
    const details =
      typeof exceptionResponse === 'object' && exceptionResponse
        ? Object.fromEntries(
            Object.entries(exceptionResponse as Record<string, unknown>).filter(
              ([key]) => !['message', 'statusCode', 'error'].includes(key),
            ),
          )
        : {};

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...details,
      timestamp: new Date().toISOString(),
      path: ctx.getRequest().url,
    });
  }
}

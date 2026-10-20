import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { ZodError } from 'zod';

export function errorHandler(
  error: FastifyError | AppError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  const statusFromThrown = (error as { statusCode?: number }).statusCode;
  const codeFromThrown = (error as { code?: string }).code;
  if (statusFromThrown && typeof statusFromThrown === 'number' && statusFromThrown < 500) {
    reply.status(statusFromThrown).send({
      error: {
        code: codeFromThrown ?? 'error',
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    reply.status(400).send({
      error: {
        code: 'validation_error',
        message: 'Invalid request',
        details: error.flatten(),
      },
    });
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  reply.status(500).send({
    error: {
      code: 'internal_error',
      message: 'Internal server error',
    },
  });
}

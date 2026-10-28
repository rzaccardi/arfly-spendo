export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function unauthorized(message = 'Unauthorized'): AppError {
  return new AppError(401, 'unauthorized', message);
}

export function forbidden(message = 'Forbidden'): AppError {
  return new AppError(403, 'forbidden', message);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError(404, 'not_found', message);
}

export function badRequest(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(400, 'bad_request', message, details);
}

export function conflict(message: string): AppError {
  return new AppError(409, 'conflict', message);
}

export function tooManyRequests(
  message = 'Rate limit exceeded',
  details?: Record<string, unknown>,
): AppError {
  return new AppError(429, 'rate_limited', message, details);
}

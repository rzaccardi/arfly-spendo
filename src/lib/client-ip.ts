import type { FastifyRequest } from 'fastify';

/**
 * Real client IP for rate limiting and admin login lockout.
 *
 * `X-Forwarded-For` is client-controlled (its left-most entry can be anything), so it is
 * never trusted. When CLIENT_IP_HEADER is set (DigitalOcean App Platform: `do-connecting-ip`,
 * which the edge overwrites), that header is used; otherwise the TCP peer address.
 */
export function getClientIp(request: FastifyRequest, clientIpHeader: string): string {
  if (clientIpHeader) {
    const raw = request.headers[clientIpHeader.toLowerCase()];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
    if (value) return value;
  }
  return request.socket.remoteAddress ?? request.ip ?? 'unknown';
}

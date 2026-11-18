import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { getClientIp } from '../../src/lib/client-ip.js';
import { buildSslOptions } from '../../src/db/client.js';
import { assertSecureWebhookUrl } from '../../src/domain/webhooks.js';

function fakeRequest(headers: Record<string, string>, remoteAddress = '10.0.0.5') {
  return { headers, socket: { remoteAddress }, ip: remoteAddress } as unknown as FastifyRequest;
}

describe('getClientIp', () => {
  it('ignores a spoofed X-Forwarded-For', () => {
    const req = fakeRequest({ 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req, '')).toBe('10.0.0.5');
    expect(getClientIp(req, 'do-connecting-ip')).toBe('10.0.0.5');
  });

  it('uses the platform header when configured', () => {
    const req = fakeRequest({ 'do-connecting-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' });
    expect(getClientIp(req, 'do-connecting-ip')).toBe('203.0.113.7');
    expect(getClientIp(req, 'DO-Connecting-IP')).toBe('203.0.113.7');
  });
});

describe('buildSslOptions', () => {
  const remote = 'postgresql://u:p@db.example.com:25060/spendo?sslmode=require';
  const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';

  it('returns nothing without a CA (legacy encrypted-only mode)', () => {
    expect(buildSslOptions(remote, '')).toBeUndefined();
  });

  it('verifies against the CA for remote hosts', () => {
    const ssl = buildSslOptions(remote, pem);
    expect(ssl?.rejectUnauthorized).toBe(true);
    expect(ssl?.ca).toBe(pem);
  });

  it('accepts a CA with escaped newlines', () => {
    expect(buildSslOptions(remote, pem.replace(/\n/g, '\\n'))?.ca).toBe(pem);
  });

  it('skips TLS for localhost', () => {
    expect(buildSslOptions('postgresql://u:p@localhost:5432/spendo', pem)).toBeUndefined();
  });
});

describe('assertSecureWebhookUrl', () => {
  it('accepts https', () => {
    expect(assertSecureWebhookUrl('https://vix.example.com/hook', 'production').protocol).toBe(
      'https:',
    );
  });

  it('rejects http in production, even on localhost', () => {
    expect(() => assertSecureWebhookUrl('http://vix.example.com/hook', 'production')).toThrow();
    expect(() => assertSecureWebhookUrl('http://127.0.0.1:9/hook', 'production')).toThrow();
  });

  it('allows http only for localhost outside production', () => {
    expect(() => assertSecureWebhookUrl('http://127.0.0.1:9/hook', 'development')).not.toThrow();
    expect(() => assertSecureWebhookUrl('http://vix.example.com/hook', 'development')).toThrow();
  });

  it('rejects other schemes', () => {
    expect(() => assertSecureWebhookUrl('ftp://example.com/x', 'development')).toThrow();
  });
});

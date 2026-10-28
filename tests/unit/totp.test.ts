import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  verifyTotpCode,
} from '../../src/auth/totp.js';
import { createHmac } from 'node:crypto';

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

describe('TOTP helpers', () => {
  it('round-trips base32', () => {
    const raw = Buffer.from('HelloSpendo!!');
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  it('verifies a current TOTP code', () => {
    const secret = generateTotpSecret();
    const decoded = base32Decode(secret);
    const nowMs = Date.now();
    const counter = Math.floor(nowMs / 1000 / 30);
    const code = hotp(decoded, counter);
    expect(verifyTotpCode(secret, code, { nowMs })).toBe(true);
    expect(verifyTotpCode(secret, '000000', { nowMs })).toBe(false);
  });

  it('normalizes recovery codes', () => {
    expect(normalizeRecoveryCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });
});

/**
 * Money helpers — always decimal strings, never floats.
 */

function stripTrailingZeros(value: string): string {
  if (!value.includes('.')) return value;
  const normalized = value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return normalized === '-0' ? '0' : normalized;
}

export function toDecimalString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid amount');
    return stripTrailingZeros(value.toFixed(4));
  }
  const trimmed = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  return stripTrailingZeros(trimmed);
}

export function compareDecimal(a: string, b: string): number {
  const aa = Number(a);
  const bb = Number(b);
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}

export function isNegative(amount: string): boolean {
  return amount.trim().startsWith('-') && compareDecimal(amount, '0') < 0;
}

export function absDecimal(amount: string): string {
  return amount.trim().startsWith('-') ? amount.trim().slice(1) : amount.trim();
}

/** Sum decimal strings using integer-scaled arithmetic (4 decimal places). */
export function sumDecimals(values: string[]): string {
  let total = 0n;
  const scale = 10000n;
  for (const v of values) {
    total += toScaled(v, scale);
  }
  return fromScaled(total, scale);
}

function toScaled(value: string, scale: bigint): bigint {
  const s = toDecimalString(value);
  const neg = s.startsWith('-');
  const raw = neg ? s.slice(1) : s;
  const [whole = '0', frac = ''] = raw.split('.');
  const fracPadded = (frac + '0000').slice(0, 4);
  const scaled = BigInt(whole) * scale + BigInt(fracPadded);
  return neg ? -scaled : scaled;
}

function fromScaled(scaled: bigint, scale: bigint): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const whole = abs / scale;
  const frac = (abs % scale).toString().padStart(4, '0').replace(/0+$/, '');
  const body = frac.length ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${body}` : body;
}

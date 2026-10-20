import { toDecimalString } from '../../lib/amounts.js';
import type { BankAccount, BankBalance, BankTransaction, PendingSnapshot } from '../types.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function mapFintableAccount(raw: unknown): BankAccount {
  const r = asRecord(raw);
  const enabled = r.enabled === undefined ? true : Boolean(r.enabled);
  return {
    externalId: asString(r.id),
    name: asString(r.display_name || r.name || r.id),
    iban: asNullableString(r.iban),
    currency: asString(r.currency, 'EUR'),
    accountType: asNullableString(r.type),
    status: enabled ? 'active' : 'disabled',
    balance: r.balance != null ? toDecimalString(asString(r.balance)) : null,
    balanceAvailable:
      r.balance_available != null ? toDecimalString(asString(r.balance_available)) : null,
    lastProviderUpdateAt: asNullableString(r.updated_at),
  };
}

export function balancesFromAccount(account: BankAccount): BankBalance[] {
  const asOf = account.lastProviderUpdateAt ?? new Date().toISOString();
  const out: BankBalance[] = [];
  if (account.balance != null) {
    out.push({
      balanceType: 'booked',
      amount: account.balance,
      currency: account.currency,
      asOf,
    });
  }
  if (account.balanceAvailable != null) {
    out.push({
      balanceType: 'available',
      amount: account.balanceAvailable,
      currency: account.currency,
      asOf,
    });
  }
  return out;
}

export function mapFintableTransaction(raw: unknown): BankTransaction {
  const r = asRecord(raw);
  const creditor = asRecord(r.creditorAccount ?? r.creditor_account);
  const debtor = asRecord(r.debtorAccount ?? r.debtor_account);
  const counterpartyIban =
    asNullableString(creditor.iban) ??
    asNullableString(debtor.iban) ??
    asNullableString(r.counterparty_iban);

  return {
    externalId: asString(r.id),
    bookingDate: asString(r.date),
    valueDate: asNullableString(r.auth_date) ?? asNullableString(r.date),
    amount: toDecimalString(asString(r.amount, '0')),
    currency: asString(r.currency, 'EUR'),
    description: asNullableString(r.description),
    counterpartyName: asNullableString(r.merchant) ?? asNullableString(r.counterparty_name),
    counterpartyIban,
    status: 'booked',
    providerUpdatedAt: asNullableString(r.updated_at),
    raw: r,
  };
}

export function mapPendingSnapshot(payload: unknown): PendingSnapshot {
  const p = asRecord(payload);
  const itemsRaw = Array.isArray(p.data) ? p.data : [];
  return {
    supported: p.supported === undefined ? true : Boolean(p.supported),
    asOf: asNullableString(p.as_of),
    items: itemsRaw.map((item) => {
      const r = asRecord(item);
      return {
        bookingDate: asString(r.date),
        amount: toDecimalString(asString(r.amount, '0')),
        currency: asString(r.currency, 'EUR'),
        description: asNullableString(r.description),
        counterpartyName: asNullableString(r.merchant),
        raw: r,
      };
    }),
  };
}

export function unwrapListData(payload: unknown): unknown[] {
  const p = asRecord(payload);
  if (Array.isArray(p.data)) return p.data;
  if (Array.isArray(payload)) return payload as unknown[];
  return [];
}

export function unwrapObjectData(payload: unknown): unknown {
  const p = asRecord(payload);
  if ('data' in p) return p.data;
  return payload;
}

export function nextCursorFromPage(payload: unknown): string | null {
  const p = asRecord(payload);
  const cursor = p.next_cursor;
  if (cursor === null || cursor === undefined || cursor === '') return null;
  return String(cursor);
}

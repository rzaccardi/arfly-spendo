import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { balances, bankAccounts, providerConnections, transactions } from '../db/schema.js';
import { toDecimalString, sumDecimals, isNegative, absDecimal } from '../lib/amounts.js';

export type SummaryOptions = {
  tenantIds: string[];
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export async function buildSummary(db: Db, opts: SummaryOptions) {
  const tenantIds = opts.tenantId
    ? opts.tenantIds.filter((id) => id === opts.tenantId)
    : opts.tenantIds;

  if (tenantIds.length === 0) {
    return emptySummary();
  }

  const accounts = await db
    .select()
    .from(bankAccounts)
    .where(and(inArray(bankAccounts.tenantId, tenantIds), eq(bankAccounts.status, 'active')));

  const accountBalances = [];
  for (const account of accounts) {
    const bals = await db
      .select()
      .from(balances)
      .where(eq(balances.bankAccountId, account.id))
      .orderBy(sql`${balances.retrievedAt} DESC`)
      .limit(10);

    const latestByType = new Map<string, (typeof bals)[number]>();
    for (const b of bals) {
      if (!latestByType.has(b.balanceType)) latestByType.set(b.balanceType, b);
    }
    const booked = latestByType.get('booked');
    const available = latestByType.get('available');

    accountBalances.push({
      account_id: account.id,
      account_name: account.name,
      currency: account.currency,
      booked: booked ? toDecimalString(booked.amount) : null,
      available: available ? toDecimalString(available.amount) : null,
      as_of: (booked ?? available)?.asOf.toISOString() ?? null,
    });
  }

  // Aggregates per currency — NEVER sum different currencies
  const balancesByCurrency: Record<string, string> = {};
  for (const ab of accountBalances) {
    if (ab.booked == null) continue;
    const prev = balancesByCurrency[ab.currency] ?? '0';
    balancesByCurrency[ab.currency] = sumDecimals([prev, ab.booked]);
  }

  const txConditions = [inArray(transactions.tenantId, tenantIds)];
  if (opts.dateFrom) txConditions.push(gte(transactions.bookingDate, opts.dateFrom));
  if (opts.dateTo) txConditions.push(lte(transactions.bookingDate, opts.dateTo));

  const txs = await db
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(and(...txConditions));

  const inflowsByCurrency: Record<string, string[]> = {};
  const outflowsByCurrency: Record<string, string[]> = {};
  for (const tx of txs) {
    const amount = toDecimalString(tx.amount);
    if (isNegative(amount)) {
      (outflowsByCurrency[tx.currency] ??= []).push(absDecimal(amount));
    } else {
      (inflowsByCurrency[tx.currency] ??= []).push(amount);
    }
  }

  const sumMap = (m: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(m).map(([currency, values]) => [currency, sumDecimals(values)]),
    );

  const connections = await db
    .select()
    .from(providerConnections)
    .where(inArray(providerConnections.tenantId, tenantIds));

  const lastUpdate = connections
    .map((c) => c.lastSuccessfulSyncAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    accounts: accountBalances,
    aggregates: {
      balances_by_currency: balancesByCurrency,
      inflows_by_currency: sumMap(inflowsByCurrency),
      outflows_by_currency: sumMap(outflowsByCurrency),
    },
    transaction_count: txs.length,
    period: {
      date_from: opts.dateFrom ?? null,
      date_to: opts.dateTo ?? null,
    },
    last_update_at: lastUpdate?.toISOString() ?? null,
  };
}

function emptySummary() {
  return {
    accounts: [],
    aggregates: {
      balances_by_currency: {},
      inflows_by_currency: {},
      outflows_by_currency: {},
    },
    transaction_count: 0,
    period: { date_from: null, date_to: null },
    last_update_at: null,
  };
}

export type CashflowGranularity = 'day' | 'week' | 'month';

export type CashflowOptions = {
  tenantIds: string[];
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
  granularity?: CashflowGranularity;
};

function periodKey(bookingDate: string, granularity: CashflowGranularity): string {
  if (granularity === 'day') return bookingDate;
  if (granularity === 'month') return bookingDate.slice(0, 7);
  // ISO week: Monday-start week labeled by Monday date
  const d = new Date(`${bookingDate}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

/**
 * Cash-flow style series: inflows/outflows/net per period, **per currency**.
 * Currencies are never mixed.
 */
export async function buildCashflow(db: Db, opts: CashflowOptions) {
  const tenantIds = opts.tenantId
    ? opts.tenantIds.filter((id) => id === opts.tenantId)
    : opts.tenantIds;
  const granularity: CashflowGranularity = opts.granularity ?? 'month';

  if (tenantIds.length === 0) {
    return {
      granularity,
      period: { date_from: opts.dateFrom ?? null, date_to: opts.dateTo ?? null },
      by_currency: {} as Record<
        string,
        {
          periods: Array<{ period: string; inflow: string; outflow: string; net: string; count: number }>;
          totals: { inflow: string; outflow: string; net: string; count: number };
        }
      >,
    };
  }

  const txConditions = [inArray(transactions.tenantId, tenantIds)];
  if (opts.dateFrom) txConditions.push(gte(transactions.bookingDate, opts.dateFrom));
  if (opts.dateTo) txConditions.push(lte(transactions.bookingDate, opts.dateTo));

  const txs = await db
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .where(and(...txConditions));

  type Bucket = { inflows: string[]; outflows: string[]; count: number };
  const byCurrency = new Map<string, Map<string, Bucket>>();

  for (const tx of txs) {
    const currency = tx.currency;
    const period = periodKey(tx.bookingDate, granularity);
    if (!byCurrency.has(currency)) byCurrency.set(currency, new Map());
    const periods = byCurrency.get(currency)!;
    if (!periods.has(period)) periods.set(period, { inflows: [], outflows: [], count: 0 });
    const bucket = periods.get(period)!;
    const amount = toDecimalString(tx.amount);
    if (isNegative(amount)) bucket.outflows.push(absDecimal(amount));
    else bucket.inflows.push(amount);
    bucket.count += 1;
  }

  const by_currency: Record<
    string,
    {
      periods: Array<{ period: string; inflow: string; outflow: string; net: string; count: number }>;
      totals: { inflow: string; outflow: string; net: string; count: number };
    }
  > = {};

  for (const [currency, periods] of byCurrency) {
    const sortedKeys = [...periods.keys()].sort();
    const series = sortedKeys.map((period) => {
      const b = periods.get(period)!;
      const inflow = sumDecimals(b.inflows);
      const outflow = sumDecimals(b.outflows);
      const net = sumDecimals([inflow, `-${outflow}`]);
      return { period, inflow, outflow, net, count: b.count };
    });
    const allIn = series.map((s) => s.inflow);
    const allOut = series.map((s) => s.outflow);
    const inflow = sumDecimals(allIn);
    const outflow = sumDecimals(allOut);
    by_currency[currency] = {
      periods: series,
      totals: {
        inflow,
        outflow,
        net: sumDecimals([inflow, `-${outflow}`]),
        count: series.reduce((n, s) => n + s.count, 0),
      },
    };
  }

  return {
    granularity,
    period: { date_from: opts.dateFrom ?? null, date_to: opts.dateTo ?? null },
    by_currency,
  };
}

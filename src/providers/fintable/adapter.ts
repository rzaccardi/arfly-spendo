import type {
  BankingProvider,
  BankAccount,
  BankBalance,
  TransactionPage,
  TransactionQueryOptions,
  PendingSnapshot,
  ProviderCapabilities,
} from '../types.js';
import { FintableClient, FintableHttpError } from './client.js';
import {
  balancesFromAccount,
  mapFintableAccount,
  mapFintableTransaction,
  mapPendingSnapshot,
  nextCursorFromPage,
  unwrapListData,
  unwrapObjectData,
} from './mapper.js';

export const FINTABLE_CAPABILITIES: ProviderCapabilities = {
  supportsPendingSnapshot: true,
  supportsIncrementalUpdatedSince: true,
  supportsDeletionEvents: false,
};

export type FintableAdapterOptions = {
  client: FintableClient;
  /** Optional in-memory fixtures for dry-run / tests */
  fixtures?: {
    accounts?: unknown[];
    transactionsByAccount?: Record<string, unknown[]>;
    pendingByAccount?: Record<string, unknown>;
  };
};

export class FintableProvider implements BankingProvider {
  readonly name = 'fintable';
  readonly capabilities = FINTABLE_CAPABILITIES;

  private readonly client: FintableClient;
  private readonly fixtures: FintableAdapterOptions['fixtures'];
  private accountCache = new Map<string, BankAccount>();

  constructor(opts: FintableAdapterOptions) {
    this.client = opts.client;
    this.fixtures = opts.fixtures;
  }

  async listAccounts(_connectionId: string): Promise<BankAccount[]> {
    if (this.fixtures?.accounts) {
      const mapped = this.fixtures.accounts.map(mapFintableAccount);
      for (const a of mapped) this.accountCache.set(a.externalId, a);
      return mapped;
    }

    try {
      const payload = await this.client.get<unknown>('/accounts');
      const mapped = unwrapListData(payload).map(mapFintableAccount);
      for (const a of mapped) this.accountCache.set(a.externalId, a);
      return mapped;
    } catch (err) {
      if (err instanceof FintableHttpError && err.status === 503 && this.fixtures?.accounts) {
        return this.listAccounts(_connectionId);
      }
      throw err;
    }
  }

  async getBalances(accountExternalId: string): Promise<BankBalance[]> {
    let account = this.accountCache.get(accountExternalId);
    if (!account) {
      if (this.fixtures?.accounts) {
        account = mapFintableAccount(
          this.fixtures.accounts.find((a) => {
            const r = a as { id?: string };
            return r.id === accountExternalId;
          }),
        );
      } else {
        const payload = await this.client.get<unknown>(`/accounts/${accountExternalId}`);
        account = mapFintableAccount(unwrapObjectData(payload));
      }
      this.accountCache.set(accountExternalId, account);
    }
    return balancesFromAccount(account);
  }

  async getTransactions(
    accountExternalId: string | null,
    options: TransactionQueryOptions,
  ): Promise<TransactionPage> {
    if (this.fixtures) {
      const all = accountExternalId
        ? (this.fixtures.transactionsByAccount?.[accountExternalId] ?? [])
        : Object.values(this.fixtures.transactionsByAccount ?? {}).flat();
      let filtered = all;
      if (options.updatedSince) {
        const since = Date.parse(options.updatedSince);
        filtered = all.filter((tx) => {
          const u = (tx as { updated_at?: string }).updated_at;
          return u ? Date.parse(u) >= since : true;
        });
      }
      if (options.dateFrom) {
        filtered = filtered.filter(
          (tx) => String((tx as { date?: string }).date ?? '') >= options.dateFrom!,
        );
      }
      if (options.dateTo) {
        filtered = filtered.filter(
          (tx) => String((tx as { date?: string }).date ?? '') <= options.dateTo!,
        );
      }
      return {
        data: filtered.map(mapFintableTransaction),
        nextCursor: null,
      };
    }

    const query: Record<string, string | number | string[] | undefined> = {
      order: options.order ?? (options.updatedSince ? 'updated' : 'date'),
      limit: options.limit ?? 200,
      cursor: options.cursor ?? undefined,
      updated_since: options.updatedSince ?? undefined,
      date_from: options.dateFrom ?? undefined,
      date_to: options.dateTo ?? undefined,
    };
    if (accountExternalId) {
      query['account_ids[]'] = [accountExternalId];
    } else if (options.accountExternalIds?.length) {
      query['account_ids[]'] = options.accountExternalIds;
    }

    const payload = await this.client.get<unknown>('/transactions', query);
    return {
      data: unwrapListData(payload).map(mapFintableTransaction),
      nextCursor: nextCursorFromPage(payload),
    };
  }

  async getPendingTransactions(accountExternalId: string): Promise<PendingSnapshot> {
    if (this.fixtures?.pendingByAccount?.[accountExternalId]) {
      return mapPendingSnapshot(this.fixtures.pendingByAccount[accountExternalId]);
    }
    if (this.fixtures) {
      return { supported: true, asOf: new Date().toISOString(), items: [] };
    }

    const payload = await this.client.get<unknown>(
      `/accounts/${accountExternalId}/transactions/pending`,
    );
    return mapPendingSnapshot(payload);
  }

  async requestProviderSync(): Promise<{ accepted: boolean; retryAfterSeconds?: number }> {
    if (this.fixtures) {
      return { accepted: true };
    }
    try {
      await this.client.post('/sync');
      return { accepted: true };
    } catch (err) {
      if (err instanceof FintableHttpError && err.status === 429) {
        return { accepted: false, retryAfterSeconds: err.retryAfterSeconds ?? 3600 };
      }
      throw err;
    }
  }
}

export function createFintableProvider(
  client: FintableClient,
  fixtures?: FintableAdapterOptions['fixtures'],
): FintableProvider {
  return new FintableProvider({ client, fixtures });
}

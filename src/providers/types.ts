export type BankAccount = {
  externalId: string;
  name: string;
  iban: string | null;
  currency: string;
  accountType: string | null;
  status: 'active' | 'disabled' | 'unknown';
  balance: string | null;
  balanceAvailable: string | null;
  lastProviderUpdateAt: string | null;
};

export type BankBalance = {
  balanceType: 'booked' | 'available' | string;
  amount: string;
  currency: string;
  asOf: string;
};

export type BankTransaction = {
  externalId: string;
  bookingDate: string;
  valueDate: string | null;
  amount: string;
  currency: string;
  description: string | null;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  status: string;
  providerUpdatedAt: string | null;
  raw: Record<string, unknown>;
};

export type TransactionQueryOptions = {
  updatedSince?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  cursor?: string | null;
  limit?: number;
  accountExternalIds?: string[];
  order?: 'date' | 'updated';
};

export type TransactionPage = {
  data: BankTransaction[];
  nextCursor: string | null;
};

export type PendingSnapshot = {
  supported: boolean;
  asOf: string | null;
  items: Array<{
    bookingDate: string;
    amount: string;
    currency: string;
    description: string | null;
    counterpartyName: string | null;
    raw?: Record<string, unknown>;
  }>;
};

export type ProviderCapabilities = {
  supportsPendingSnapshot: boolean;
  supportsIncrementalUpdatedSince: boolean;
  supportsDeletionEvents: boolean;
};

export interface BankingProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  listAccounts(connectionId: string): Promise<BankAccount[]>;
  getBalances(accountExternalId: string): Promise<BankBalance[]>;
  getTransactions(
    accountExternalId: string | null,
    options: TransactionQueryOptions,
  ): Promise<TransactionPage>;
  getPendingTransactions?(accountExternalId: string): Promise<PendingSnapshot>;
  requestProviderSync?(): Promise<{ accepted: boolean; retryAfterSeconds?: number }>;
}

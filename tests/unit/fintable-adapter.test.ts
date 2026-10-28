import { describe, expect, it } from 'vitest';
import { FintableClient } from '../../src/providers/fintable/client.js';
import { createFintableProvider } from '../../src/providers/fintable/adapter.js';
import { FINTABLE_CAPABILITIES } from '../../src/providers/fintable/adapter.js';

describe('Fintable adapter', () => {
  it('declares documented capabilities', () => {
    expect(FINTABLE_CAPABILITIES).toEqual({
      supportsPendingSnapshot: true,
      supportsIncrementalUpdatedSince: true,
      supportsDeletionEvents: false,
    });
  });

  it('lists accounts and transactions from fixtures without live HTTP', async () => {
    const client = new FintableClient({
      baseUrl: 'https://fintable.io/api/v2',
      token: '',
      workspaceId: 'ws_test',
      dryRun: true,
    });
    const provider = createFintableProvider(client, {
      accounts: [
        {
          id: 'acc_1',
          name: 'Main',
          currency: 'EUR',
          balance: '100.00',
          balance_available: '90.00',
          enabled: true,
          updated_at: '2026-01-01T00:00:00Z',
        },
      ],
      transactionsByAccount: {
        acc_1: [
          {
            id: 'tx_1',
            date: '2026-01-02',
            amount: '-5.00',
            currency: 'EUR',
            description: 'Shop',
            updated_at: '2026-01-03T00:00:00Z',
          },
        ],
      },
      pendingByAccount: {
        acc_1: {
          data: [
            {
              account_id: 'acc_1',
              date: '2026-01-04',
              amount: '-1.00',
              currency: 'EUR',
              description: 'Pending',
            },
          ],
          supported: true,
          as_of: '2026-01-04T00:00:00Z',
        },
      },
    });

    const accounts = await provider.listAccounts('conn');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.balance).toBe('100');

    const bals = await provider.getBalances('acc_1');
    expect(bals.map((b) => b.balanceType).sort()).toEqual(['available', 'booked']);

    const page = await provider.getTransactions('acc_1', { updatedSince: '2026-01-01T00:00:00Z' });
    expect(page.data[0]!.amount).toBe('-5');

    const pending = await provider.getPendingTransactions!('acc_1');
    expect(pending.items).toHaveLength(1);
    expect(pending.supported).toBe(true);
  });

  it('lists workspaces without sending workspace_id', async () => {
    const calls: string[] = [];
    const client = new FintableClient({
      baseUrl: 'https://fintable.io/api/v2',
      token: 'pat_test',
      workspaceId: 'ws_should_not_be_sent',
      dryRun: false,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'ws_history',
                name: 'History',
                role: 'owner',
                is_default: true,
              },
              { id: '', name: 'skip' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const workspaces = await client.listWorkspaces();
    expect(workspaces).toEqual([
      { id: 'ws_history', name: 'History', role: 'owner', is_default: true },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('https://fintable.io/api/v2/workspaces');
    expect(calls[0]).not.toContain('workspace_id');
  });
});

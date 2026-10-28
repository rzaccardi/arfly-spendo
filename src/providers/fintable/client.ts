import { getConfig } from '../../lib/config.js';

export class FintableHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'FintableHttpError';
  }
}

export type FintableClientOptions = {
  baseUrl: string;
  token: string;
  workspaceId: string;
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
};

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

export type FintableWorkspace = {
  id: string;
  name: string;
  role: string;
  is_default: boolean;
};

export class FintableClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly workspaceId: string;
  private readonly dryRun: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FintableClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.workspaceId = opts.workspaceId;
    this.dryRun = Boolean(opts.dryRun);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromEnv(workspaceId: string, tokenOverride?: string): FintableClient {
    const cfg = getConfig();
    return new FintableClient({
      baseUrl: cfg.FINTABLE_BASE_URL,
      token: tokenOverride || cfg.FINTABLE_API_TOKEN,
      workspaceId,
      dryRun: cfg.fintableDryRun && !(tokenOverride || cfg.FINTABLE_API_TOKEN),
    });
  }

  async get<T>(path: string, query: Query = {}): Promise<T> {
    return this.request<T>('GET', path, query);
  }

  async post<T>(path: string, query: Query = {}, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, query, body);
  }

  /**
   * Workspaces this credential may select. Fintable rejects `workspace_id` on this route.
   * An official dashboard ID is absent here when the token has no grant for it.
   */
  async listWorkspaces(): Promise<FintableWorkspace[]> {
    const payload = await this.request<unknown>('GET', '/workspaces', {}, undefined, {
      includeWorkspace: false,
    });
    const rows =
      payload &&
      typeof payload === 'object' &&
      'data' in payload &&
      Array.isArray((payload as { data: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const rec = row as Record<string, unknown>;
      if (typeof rec.id !== 'string' || !rec.id) return [];
      return [
        {
          id: rec.id,
          name: typeof rec.name === 'string' && rec.name ? rec.name : rec.id,
          role: typeof rec.role === 'string' ? rec.role : '',
          is_default: rec.is_default === true,
        },
      ];
    });
  }

  private async request<T>(
    method: string,
    path: string,
    query: Query = {},
    body?: unknown,
    opts?: { includeWorkspace?: boolean },
  ): Promise<T> {
    if (this.dryRun || !this.token) {
      throw new FintableHttpError(503, 'Fintable dry-run mode: live HTTP disabled');
    }

    const url = new URL(`${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    if (opts?.includeWorkspace !== false) {
      url.searchParams.set('workspace_id', this.workspaceId);
    }
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await this.fetchImpl(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

    let parsed: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }

    if (!res.ok) {
      const message =
        typeof parsed === 'object' &&
        parsed &&
        'error' in parsed &&
        typeof (parsed as { error?: { message?: string } }).error?.message === 'string'
          ? (parsed as { error: { message: string } }).error.message
          : `Fintable HTTP ${res.status}`;
      throw new FintableHttpError(
        res.status,
        message,
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
        parsed,
      );
    }

    return parsed as T;
  }
}

/** Shared token-level mutex so concurrent workspace syncs serialize when sharing one PAT. */
const tokenLocks = new Map<string, Promise<void>>();

export async function withTokenLock<T>(tokenKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = tokenLocks.get(tokenKey) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  tokenLocks.set(
    tokenKey,
    prev.then(() => gate),
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tokenLocks.get(tokenKey) === gate) {
      // keep chain for subsequent waiters
    }
  }
}

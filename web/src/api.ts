export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.json !== undefined) {
    headers.set('content-type', 'application/json');
  }
  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include',
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  });
  if (!res.ok) {
    throw new ApiError(res.status, await parseError(res));
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/csv')) {
    return (await res.text()) as T;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

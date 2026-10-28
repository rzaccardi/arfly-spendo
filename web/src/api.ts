export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function parseErrorBody(
  res: Response,
): Promise<{ message: string; code?: string; details?: Record<string, unknown> }> {
  try {
    const body = await res.json();
    return {
      message: body?.error?.message ?? res.statusText,
      code: body?.error?.code,
      details: body?.error?.details,
    };
  } catch {
    return { message: res.statusText };
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
    const err = await parseErrorBody(res);
    throw new ApiError(res.status, err.message, err.code, err.details);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/csv')) {
    return (await res.text()) as T;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

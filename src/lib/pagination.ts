export type CursorPayload = {
  createdAt: string;
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as CursorPayload;
    if (!parsed?.createdAt || !parsed?.id) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new Error('Invalid cursor');
  }
}

export function paginationResponse<T extends { id: string; createdAt?: Date | string | null }>(
  rows: T[],
  limit: number,
): { data: T[]; pagination: { next_cursor: string | null; has_more: boolean } } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  let nextCursor: string | null = null;
  if (hasMore && last) {
    const createdAt =
      last.createdAt instanceof Date
        ? last.createdAt.toISOString()
        : String(last.createdAt ?? new Date().toISOString());
    nextCursor = encodeCursor({ createdAt, id: last.id });
  }
  return {
    data,
    pagination: {
      next_cursor: nextCursor,
      has_more: hasMore,
    },
  };
}

export function clampLimit(limit: number | undefined, fallback = 50, max = 200): number {
  if (limit === undefined || Number.isNaN(limit)) return fallback;
  return Math.min(Math.max(1, limit), max);
}

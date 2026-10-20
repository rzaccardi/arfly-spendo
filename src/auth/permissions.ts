export const PERMISSIONS = [
  'accounts:read',
  'balances:read',
  'transactions:read',
  'sync:request',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function hasPermission(granted: string[], required: Permission): boolean {
  return granted.includes(required);
}

export const ALL_READ_PERMISSIONS: Permission[] = [
  'accounts:read',
  'balances:read',
  'transactions:read',
];

export const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

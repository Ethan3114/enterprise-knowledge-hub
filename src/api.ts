import { roleSchema, type Role } from './domain';

const ROLE_KEY = 'enterprise-knowledge-hub-role';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function readStoredRole(): Role | null {
  const saved = window.sessionStorage.getItem(ROLE_KEY);
  const parsed = roleSchema.safeParse(saved);
  return parsed.success ? parsed.data : null;
}

export function storeRole(role: Role | null) {
  if (role) {
    window.sessionStorage.setItem(ROLE_KEY, role);
    return;
  }
  window.sessionStorage.removeItem(ROLE_KEY);
}

function errorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('detail' in payload)) {
    return '请求失败';
  }
  const detail = payload.detail;
  if (typeof detail === 'string') {
    return detail;
  }
  return '提交的内容不完整';
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const role = readStoredRole();
  const headers = new Headers(init.headers);
  if (role) {
    headers.set('X-Role', role);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(errorMessage(payload), response.status);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export async function apiStream(path: string, body: unknown) {
  const role = readStoredRole();
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(role ? { 'X-Role': role } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new ApiError(errorMessage(payload), response.status);
  }
  return response.body;
}

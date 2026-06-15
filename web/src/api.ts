const BASE = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  const data: unknown = await res.json().catch(() => ({ message: 'Network error' }));
  if (!res.ok) {
    const msg = (data as { message?: string }).message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  return handleResponse<T>(res);
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export async function apiPostAdmin<T>(path: string, body: unknown, adminCreds: { user: string; password: string }): Promise<T> {
  const credentials = btoa(`${adminCreds.user}:${adminCreds.password}`);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify(body),
  });
  return handleResponse<T>(res);
}

export interface Product {
  id: number;
  handle: string;
  name: string;
  priceInCents: number;
  intervalUnit: string;
}

export interface Consultant {
  id: string;
  name: string;
}

export interface HealthResponse {
  status: string;
  sessions: number;
  transactions: number;
  maxioSite: string;
  maxioOk: boolean;
  slackOk: boolean;
}

export interface MutatingResponse {
  status: 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';
  txnId?: string;
  channelId?: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface Component {
  id: number;
  handle: string;
  name: string;
  unitName: string;
  kind: string;
  unitPrice?: string;
}

export interface PlanChangePreview {
  fromPlanHandle: string;
  fromPlanName: string;
  toPlanHandle: string;
  toPlanName: string;
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  paymentDueInCents: number;
  creditAppliedInCents: number;
  paymentDueDisplay: string;
}

export interface PlanChangeResult extends MutatingResponse {
  subscriptionState: string;
  fromPlanName: string;
  toPlanName: string;
  timing: string;
  paymentDueInCents: number;
}

export interface UsageResult extends MutatingResponse {
  usageId: number;
  quantity: number;
  componentHandle: string;
  componentName: string;
  subscriptionId: number;
}

export interface BookResult extends MutatingResponse {
  subscriptionId: number;
  subscriptionState: string;
  planHandle: string;
  consultantId: string;
  consultantInvited: boolean;
  clientInvited: boolean;
  clientNotifiedByEmail: boolean;
}

export type CollectionMethod = 'automatic' | 'remittance';
export type PlanChangeTiming = 'prorate' | 'at-renewal';
export type LifecycleAction = 'pause' | 'resume' | 'cancel' | 'reactivate';
export type CancelType = 'immediate' | 'end-of-period';
export type TransactionType =
  | 'subscription'
  | 'usage'
  | 'plan-change'
  | 'lifecycle'
  | 'invoice'
  | 'digest';
export type TransactionState = 'started' | 'in-progress' | 'completed' | 'failed';
export type AppStatus = 'ok' | 'maxio_failed' | 'invalid' | 'session_expired';

export interface SessionData {
  sessionId: string;
  lastSubmission?: unknown;
  lastResult?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionRecord {
  txnId: string;
  consultantId: string;
  clientEmail: string;
  type: TransactionType;
  state: TransactionState;
  channelId?: string;
  channelName?: string;
  subscriptionId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface Consultant {
  id: string;
  name: string;
  email: string;
}

export interface ProductInfo {
  id: number;
  handle: string;
  name: string;
  priceInCents: number;
  intervalUnit: string;
}

export interface ComponentInfo {
  id: number;
  handle: string;
  name: string;
  unitName: string;
  kind: string;
  unitPrice?: string;
}

export interface MutatingResponse {
  status: AppStatus;
  txnId?: string;
  channelId?: string;
  channelName?: string;
  [key: string]: unknown;
}

export interface LineItem {
  title: string;
  quantity: number;
  unitPrice: string;
}

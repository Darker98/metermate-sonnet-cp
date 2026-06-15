import type { TransactionRecord, TransactionState } from '../types.js';

const txnMap = new Map<string, TransactionRecord>();
const channelMap = new Map<string, { channelId: string; channelName: string }>();

function channelKey(consultantId: string, clientEmail: string): string {
  return `${consultantId.toLowerCase()}:${clientEmail.toLowerCase()}`;
}

function get(txnId: string): TransactionRecord | undefined {
  return txnMap.get(txnId);
}

function put(record: TransactionRecord): void {
  txnMap.set(record.txnId, { ...record, updatedAt: Date.now() });
}

function updateState(txnId: string, state: TransactionState): void {
  const existing = txnMap.get(txnId);
  if (existing) {
    txnMap.set(txnId, { ...existing, state, updatedAt: Date.now() });
  }
}

function getChannel(
  consultantId: string,
  clientEmail: string
): { channelId: string; channelName: string } | undefined {
  return channelMap.get(channelKey(consultantId, clientEmail));
}

function putChannel(
  consultantId: string,
  clientEmail: string,
  channelId: string,
  channelName: string
): void {
  channelMap.set(channelKey(consultantId, clientEmail), { channelId, channelName });
}

function findByRef(txnRef: string): TransactionRecord | undefined {
  return txnMap.get(txnRef);
}

function txnCount(): number {
  return txnMap.size;
}

export const transactionStore = {
  get,
  put,
  updateState,
  getChannel,
  putChannel,
  findByRef,
  txnCount,
};

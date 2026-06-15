import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { transactionStore } from '../stores/transactionStore.js';
import { componentCache, reportUsage } from '../services/maxioService.js';
import { postUsageMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const usageRouter = Router();

const UsageSchema = z.object({
  sessionId: z.string().min(1),
  txnId: z.string().min(1),
  componentHandle: z.enum(['mm-consult-mins', 'mm-api-calls']),
  quantity: z.number().int().positive(),
  memo: z.string().optional(),
});

usageRouter.post('/usage', async (req, res) => {
  const parse = UsageSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const { txnId, componentHandle, quantity, memo } = parse.data;

  const bookingTxn = transactionStore.get(txnId);
  if (!bookingTxn) {
    res.status(404).json({ status: 'invalid', error: `Transaction not found: ${txnId}` });
    return;
  }
  if (bookingTxn.type !== 'subscription' || !bookingTxn.subscriptionId) {
    res.status(400).json({ status: 'invalid', error: 'txnId must reference a completed subscription booking' });
    return;
  }
  if (!bookingTxn.channelId) {
    res.status(400).json({ status: 'invalid', error: 'Booking transaction has no associated Slack channel' });
    return;
  }

  const component = componentCache.get(componentHandle);
  if (!component) {
    res.status(400).json({ status: 'invalid', error: `Component '${componentHandle}' not found — run seed first` });
    return;
  }

  const newTxnId = uuidv4();
  const now = Date.now();

  let txn: TransactionRecord = {
    txnId: newTxnId,
    consultantId: bookingTxn.consultantId,
    clientEmail: bookingTxn.clientEmail,
    type: 'usage',
    state: 'started',
    channelId: bookingTxn.channelId,
    channelName: bookingTxn.channelName,
    subscriptionId: bookingTxn.subscriptionId,
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.put(txn);

  try {
    const usageResult = await reportUsage({
      subscriptionId: bookingTxn.subscriptionId,
      componentId: component.id,
      quantity,
      memo,
    });

    await postUsageMessage({
      channelId: bookingTxn.channelId,
      componentName: component.name,
      unitName: component.unitName,
      quantity,
      memo,
      txnId: newTxnId,
      usageId: usageResult.usageId,
    });

    txn = { ...txn, state: 'completed' };
    transactionStore.put(txn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId: newTxnId,
      channelId: bookingTxn.channelId,
      channelName: bookingTxn.channelName,
      usageId: usageResult.usageId,
      quantity: usageResult.quantity,
      componentHandle,
      componentName: component.name,
      subscriptionId: bookingTxn.subscriptionId,
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(newTxnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[usage] UC2 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId: newTxnId, error: message });
  }
});

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { transactionStore } from '../stores/transactionStore.js';
import { performLifecycleAction } from '../services/maxioService.js';
import { postLifecycleMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const lifecycleRouter = Router();

const LifecycleSchema = z
  .object({
    sessionId: z.string().min(1),
    txnId: z.string().min(1),
    action: z.enum(['pause', 'resume', 'cancel', 'reactivate']),
    cancelTiming: z.enum(['immediate', 'end-of-period']).optional(),
  })
  .refine((data) => data.action !== 'cancel' || data.cancelTiming !== undefined, {
    message: 'cancelTiming is required when action is cancel',
    path: ['cancelTiming'],
  });

// ── POST /api/lifecycle ───────────────────────────────────────────────────────

lifecycleRouter.post('/lifecycle', async (req, res) => {
  const parse = LifecycleSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const { txnId, action, cancelTiming } = parse.data;

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

  const newTxnId = uuidv4();
  const now = Date.now();

  let newTxn: TransactionRecord = {
    txnId: newTxnId,
    consultantId: bookingTxn.consultantId,
    clientEmail: bookingTxn.clientEmail,
    type: 'lifecycle',
    state: 'started',
    channelId: bookingTxn.channelId,
    channelName: bookingTxn.channelName,
    subscriptionId: bookingTxn.subscriptionId,
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.put(newTxn);

  try {
    newTxn = { ...newTxn, state: 'in-progress' };
    transactionStore.put(newTxn);

    const result = await performLifecycleAction({
      subscriptionId: bookingTxn.subscriptionId,
      action,
      cancelTiming,
    });

    await postLifecycleMessage({
      channelId: bookingTxn.channelId,
      action,
      cancelTiming,
      subscriptionState: result.state,
      subscriptionId: result.subscriptionId,
      txnId: newTxnId,
    });

    newTxn = { ...newTxn, state: 'completed' };
    transactionStore.put(newTxn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId: newTxnId,
      channelId: bookingTxn.channelId,
      channelName: bookingTxn.channelName,
      subscriptionId: result.subscriptionId,
      subscriptionState: result.state,
      action,
      ...(cancelTiming !== undefined ? { cancelTiming } : {}),
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(newTxnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[lifecycle] UC4 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId: newTxnId, error: message });
  }
});

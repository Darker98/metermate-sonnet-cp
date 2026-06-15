import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { transactionStore } from '../stores/transactionStore.js';
import {
  productCache,
  readSubscription,
  previewPlanChange,
  executePlanChange,
} from '../services/maxioService.js';
import { postPlanChangeMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const planChangeRouter = Router();

const PreviewSchema = z.object({
  sessionId: z.string().min(1),
  txnId: z.string().min(1),
  newPlanHandle: z.enum(['mm-basic', 'mm-pro']),
});

const ExecuteSchema = PreviewSchema.extend({
  timing: z.enum(['prorate', 'at-renewal']),
});

// ── helpers ──────────────────────────────────────────────────────────────────

function lookupBookingTxn(txnId: string): {
  error?: { status: number; body: object };
  subscriptionId?: number;
  channelId?: string;
  channelName?: string;
  consultantId?: string;
  clientEmail?: string;
} {
  const txn = transactionStore.get(txnId);
  if (!txn) {
    return { error: { status: 404, body: { status: 'invalid', error: `Transaction not found: ${txnId}` } } };
  }
  if (txn.type !== 'subscription' || !txn.subscriptionId) {
    return { error: { status: 400, body: { status: 'invalid', error: 'txnId must reference a completed subscription booking' } } };
  }
  if (!txn.channelId) {
    return { error: { status: 400, body: { status: 'invalid', error: 'Booking transaction has no associated Slack channel' } } };
  }
  return {
    subscriptionId: txn.subscriptionId,
    channelId: txn.channelId,
    channelName: txn.channelName,
    consultantId: txn.consultantId,
    clientEmail: txn.clientEmail,
  };
}

// ── POST /api/plan-change/preview ─────────────────────────────────────────────

planChangeRouter.post('/plan-change/preview', async (req, res) => {
  const parse = PreviewSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const { txnId, newPlanHandle } = parse.data;

  const lookup = lookupBookingTxn(txnId);
  if (lookup.error) {
    res.status(lookup.error.status).json(lookup.error.body);
    return;
  }

  const newProduct = productCache.get(newPlanHandle);
  if (!newProduct) {
    res.status(400).json({ status: 'invalid', error: `Plan '${newPlanHandle}' not found — run seed first` });
    return;
  }

  try {
    const [current, preview] = await Promise.all([
      readSubscription(lookup.subscriptionId!),
      previewPlanChange(lookup.subscriptionId!, newPlanHandle),
    ]);

    if (current.productHandle === newPlanHandle) {
      res.status(400).json({ status: 'invalid', error: 'Subscription is already on that plan' });
      return;
    }

    const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

    res.json({
      status: 'ok',
      fromPlanHandle: current.productHandle,
      fromPlanName: current.productName,
      toPlanHandle: newPlanHandle,
      toPlanName: newProduct.name,
      proratedAdjustmentInCents: preview.proratedAdjustmentInCents,
      chargeInCents: preview.chargeInCents,
      paymentDueInCents: preview.paymentDueInCents,
      creditAppliedInCents: preview.creditAppliedInCents,
      paymentDueDisplay: fmt(preview.paymentDueInCents),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[plan-change/preview] failed:', message);
    res.status(500).json({ status: 'maxio_failed', error: message });
  }
});

// ── POST /api/plan-change ─────────────────────────────────────────────────────

planChangeRouter.post('/plan-change', async (req, res) => {
  const parse = ExecuteSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const { txnId, newPlanHandle, timing } = parse.data;

  const lookup = lookupBookingTxn(txnId);
  if (lookup.error) {
    res.status(lookup.error.status).json(lookup.error.body);
    return;
  }

  const newProduct = productCache.get(newPlanHandle);
  if (!newProduct) {
    res.status(400).json({ status: 'invalid', error: `Plan '${newPlanHandle}' not found — run seed first` });
    return;
  }

  const newTxnId = uuidv4();
  const now = Date.now();

  let txn: TransactionRecord = {
    txnId: newTxnId,
    consultantId: lookup.consultantId!,
    clientEmail: lookup.clientEmail!,
    type: 'plan-change',
    state: 'started',
    channelId: lookup.channelId,
    channelName: lookup.channelName,
    subscriptionId: lookup.subscriptionId,
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.put(txn);

  try {
    const [current, preview] = await Promise.all([
      readSubscription(lookup.subscriptionId!),
      previewPlanChange(lookup.subscriptionId!, newPlanHandle),
    ]);

    if (current.productHandle === newPlanHandle) {
      transactionStore.updateState(newTxnId, 'failed');
      res.status(400).json({ status: 'invalid', error: 'Subscription is already on that plan' });
      return;
    }

    txn = { ...txn, state: 'in-progress' };
    transactionStore.put(txn);

    const result = await executePlanChange({
      subscriptionId: lookup.subscriptionId!,
      newProductId: newProduct.id,
      timing,
    });

    await postPlanChangeMessage({
      channelId: lookup.channelId!,
      fromPlanName: current.productName,
      toPlanName: result.newProductName,
      timing,
      proratedAdjustmentInCents: preview.proratedAdjustmentInCents,
      paymentDueInCents: preview.paymentDueInCents,
      subscriptionState: result.state,
      txnId: newTxnId,
    });

    txn = { ...txn, state: 'completed' };
    transactionStore.put(txn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId: newTxnId,
      channelId: lookup.channelId,
      channelName: lookup.channelName,
      subscriptionId: result.subscriptionId,
      subscriptionState: result.state,
      fromPlanName: current.productName,
      toPlanName: result.newProductName,
      timing,
      paymentDueInCents: preview.paymentDueInCents,
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(newTxnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[plan-change] UC3 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId: newTxnId, error: message });
  }
});

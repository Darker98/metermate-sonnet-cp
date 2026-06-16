import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { adminGuard } from '../auth.js';
import { config } from '../config.js';
import { transactionStore } from '../stores/transactionStore.js';
import { fetchBillingDigest } from '../services/maxioService.js';
import { postDigestMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const digestRouter = Router();

const DigestSchema = z.object({
  sessionId: z.string().min(1),
  note: z.string().max(200).optional(),
});

// ── POST /api/digest ──────────────────────────────────────────────────────────

digestRouter.post('/digest', adminGuard, async (req, res) => {
  const parse = DigestSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  if (!config.slack.digestChannel) {
    res.status(503).json({
      status: 'invalid',
      error: 'SLACK_DIGEST_CHANNEL is not configured — set it in server/.env',
    });
    return;
  }

  const newTxnId = uuidv4();
  const now = Date.now();

  let newTxn: TransactionRecord = {
    txnId: newTxnId,
    consultantId: 'admin',
    clientEmail: '',
    type: 'digest',
    state: 'started',
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.put(newTxn);

  try {
    newTxn = { ...newTxn, state: 'in-progress' };
    transactionStore.put(newTxn);

    const data = await fetchBillingDigest();

    const generatedAt = new Date(now).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

    await postDigestMessage({ data, txnId: newTxnId, generatedAt });

    newTxn = { ...newTxn, state: 'completed' };
    transactionStore.put(newTxn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId: newTxnId,
      digestChannelId: config.slack.digestChannel,
      totalSubscriptions: data.subscriptions.total,
      activeSubscriptions: data.subscriptions.active,
      onHoldSubscriptions: data.subscriptions.onHold,
      canceledSubscriptions: data.subscriptions.canceled,
      totalInvoices: data.invoices.total,
      openInvoices: data.invoices.open,
      paidInvoices: data.invoices.paid,
      totalAmountSum: data.invoices.totalAmountSum,
      generatedAt,
      ...(parse.data.note ? { note: parse.data.note } : {}),
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(newTxnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[digest] UC6 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId: newTxnId, error: message });
  }
});

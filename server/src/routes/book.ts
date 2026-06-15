import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { transactionStore } from '../stores/transactionStore.js';
import { productCache, createSubscription } from '../services/maxioService.js';
import { ensureTxnChannel, postBookingMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const bookRouter = Router();

const BookSchema = z.object({
  sessionId: z.string().min(1),
  consultantId: z.string().min(1),
  clientEmail: z.string().email(),
  clientFirstName: z.string().min(1),
  clientLastName: z.string().min(1),
  planHandle: z.enum(['mm-basic', 'mm-pro']),
  collectionMethod: z.enum(['automatic', 'remittance']),
  companyName: z.string().optional(),
});

bookRouter.post('/book', async (req, res) => {
  const parse = BookSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const {
    consultantId,
    clientEmail,
    clientFirstName,
    clientLastName,
    planHandle,
    collectionMethod,
    companyName,
  } = parse.data;

  const consultant = config.consultants.find((c) => c.id === consultantId);
  if (!consultant) {
    res.status(400).json({ status: 'invalid', error: `Unknown consultant: ${consultantId}` });
    return;
  }

  const product = productCache.get(planHandle);
  if (!product) {
    res.status(400).json({
      status: 'invalid',
      error: `Plan '${planHandle}' not found — ensure seed has been run`,
    });
    return;
  }

  const txnId = uuidv4();
  const seq = transactionStore.txnCount() + 1;
  const now = Date.now();

  let txn: TransactionRecord = {
    txnId,
    consultantId,
    clientEmail,
    type: 'subscription',
    state: 'started',
    createdAt: now,
    updatedAt: now,
  };
  transactionStore.put(txn);

  try {
    const subResult = await createSubscription({
      productHandle: planHandle,
      clientEmail,
      clientFirstName,
      clientLastName,
      companyName,
      collectionMethod,
    });

    txn = { ...txn, subscriptionId: subResult.subscriptionId, state: 'in-progress' };
    transactionStore.put(txn);

    const channel = await ensureTxnChannel({
      txnId,
      consultantId,
      consultantEmail: consultant.email,
      clientEmail,
      seq,
    });

    const priceDisplay = `$${(product.priceInCents / 100).toFixed(2)}/${product.intervalUnit}`;
    await postBookingMessage({
      channelId: channel.channelId,
      consultantName: consultant.name,
      clientEmail,
      planName: product.name,
      priceDisplay,
      collectionMethod,
      txnId,
      subscriptionId: subResult.subscriptionId,
    });

    txn = {
      ...txn,
      channelId: channel.channelId,
      channelName: channel.channelName,
      state: 'completed',
    };
    transactionStore.put(txn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId,
      channelId: channel.channelId,
      channelName: channel.channelName,
      subscriptionId: subResult.subscriptionId,
      subscriptionState: subResult.state,
      planHandle,
      clientEmail,
      consultantId,
      consultantInvited: channel.consultantInvited,
      clientInvited: channel.clientInvited,
      clientNotifiedByEmail: channel.clientNotifiedByEmail,
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(txnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[book] UC1 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId, error: message });
  }
});

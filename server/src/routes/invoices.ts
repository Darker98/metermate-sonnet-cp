import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { adminGuard } from '../auth.js';
import { transactionStore } from '../stores/transactionStore.js';
import { issueAndSendInvoice } from '../services/maxioService.js';
import { postInvoiceMessage } from '../services/slackService.js';
import type { MutatingResponse, TransactionRecord } from '../types.js';

export const invoicesRouter = Router();

const LineItemSchema = z.object({
  title: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'unitPrice must be a decimal string like "150.00"'),
});

const InvoiceSchema = z.object({
  sessionId: z.string().min(1),
  txnId: z.string().min(1),
  lineItems: z.array(LineItemSchema).min(1),
});

// ── POST /api/invoices ────────────────────────────────────────────────────────

invoicesRouter.post('/invoices', adminGuard, async (req, res) => {
  const parse = InvoiceSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ status: 'invalid', errors: parse.error.flatten().fieldErrors });
    return;
  }

  const { txnId, lineItems } = parse.data;

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
    type: 'invoice',
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

    const result = await issueAndSendInvoice({
      subscriptionId: bookingTxn.subscriptionId,
      clientEmail: bookingTxn.clientEmail,
      lineItems,
    });

    await postInvoiceMessage({
      channelId: bookingTxn.channelId,
      invoiceNumber: result.invoiceNumber,
      dueAmount: result.dueAmount,
      totalAmount: result.totalAmount,
      dueDate: result.dueDate,
      invoiceStatus: result.invoiceStatus,
      subscriptionId: bookingTxn.subscriptionId,
      txnId: newTxnId,
    });

    newTxn = { ...newTxn, state: 'completed' };
    transactionStore.put(newTxn);

    const response: MutatingResponse = {
      status: 'ok',
      txnId: newTxnId,
      channelId: bookingTxn.channelId,
      channelName: bookingTxn.channelName,
      subscriptionId: bookingTxn.subscriptionId,
      invoiceUid: result.invoiceUid,
      invoiceNumber: result.invoiceNumber,
      dueAmount: result.dueAmount,
      totalAmount: result.totalAmount,
      dueDate: result.dueDate,
      issueDate: result.issueDate,
      invoiceStatus: result.invoiceStatus,
    };

    res.status(201).json(response);
  } catch (err) {
    transactionStore.updateState(newTxnId, 'failed');
    const message = err instanceof Error ? err.message : 'Internal error';
    console.error('[invoices] UC5 failed:', message);
    res.status(500).json({ status: 'maxio_failed', txnId: newTxnId, error: message });
  }
});

import { config } from '../config.js';
import { transactionStore } from '../stores/transactionStore.js';

const SLACK_API = 'https://slack.com/api';

interface SlackResponse {
  ok: boolean;
  error?: string;
}

async function slackPost<T extends SlackResponse>(
  method: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`[slack] ${method} HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as T;

  if (!data.ok) {
    throw new Error(`[slack] ${method} failed: ${data.error ?? 'unknown_error'}`);
  }

  return data;
}

async function slackGet<T extends SlackResponse>(
  method: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`[slack] ${method} HTTP ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as T;

  if (!data.ok) {
    throw new Error(`[slack] ${method} failed: ${data.error ?? 'unknown_error'}`);
  }

  return data;
}

export async function checkSlackHealth(): Promise<boolean> {
  try {
    await slackPost<SlackResponse>('auth.test');
    return true;
  } catch (err) {
    console.error('[slack] health check failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

function sanitizeChannelName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

async function resolveUserId(email: string): Promise<string | null> {
  if (!email) return null;
  try {
    const data = await slackGet<SlackResponse & { user?: { id?: string } }>(
      'users.lookupByEmail',
      { email }
    );
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function createPrivateChannel(name: string): Promise<{ id: string; name: string } | null> {
  try {
    const data = await slackPost<SlackResponse & { channel?: { id?: string; name?: string } }>(
      'conversations.create',
      { name, is_private: true }
    );
    const ch = data.channel;
    if (ch?.id && ch.name) return { id: ch.id, name: ch.name };
    return null;
  } catch (err) {
    if (err instanceof Error && err.message.includes('name_taken')) return null;
    throw err;
  }
}

async function inviteUsers(channelId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await slackPost('conversations.invite', {
      channel: channelId,
      users: userIds.join(','),
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already_in_channel')) return;
    console.error(`[slack] invite failed for channel ${channelId}:`, err instanceof Error ? err.message : err);
  }
}

export interface EnsureTxnChannelOpts {
  txnId: string;
  consultantId: string;
  consultantEmail: string;
  clientEmail: string;
  seq: number;
}

export interface TxnChannelResult {
  channelId: string;
  channelName: string;
  consultantInvited: boolean;
  clientInvited: boolean;
  clientNotifiedByEmail: boolean;
}

export async function ensureTxnChannel(opts: EnsureTxnChannelOpts): Promise<TxnChannelResult> {
  const { consultantId, consultantEmail, clientEmail, seq } = opts;

  const existing = transactionStore.getChannel(consultantId, clientEmail);
  if (existing) {
    return {
      channelId: existing.channelId,
      channelName: existing.channelName,
      consultantInvited: false,
      clientInvited: false,
      clientNotifiedByEmail: false,
    };
  }

  const clientSlug = sanitizeChannelName(clientEmail.split('@')[0] ?? clientEmail);
  const channelName = sanitizeChannelName(`txn-${consultantId}-${clientSlug}-${seq}`);

  let channel = await createPrivateChannel(channelName);

  if (!channel) {
    const ts = String(Date.now()).slice(-6);
    channel = await createPrivateChannel(sanitizeChannelName(`${channelName}-${ts}`).slice(0, 80));
  }

  if (!channel) {
    throw new Error(`[slack] Failed to create channel for txn ${opts.txnId}`);
  }

  transactionStore.putChannel(consultantId, clientEmail, channel.id, channel.name);

  const [consultantUserId, clientUserId] = await Promise.all([
    resolveUserId(consultantEmail),
    resolveUserId(clientEmail),
  ]);

  const toInvite: string[] = [];
  if (consultantUserId) toInvite.push(consultantUserId);
  if (clientUserId) toInvite.push(clientUserId);

  if (toInvite.length > 0) {
    await inviteUsers(channel.id, toInvite);
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    consultantInvited: consultantUserId !== null,
    clientInvited: clientUserId !== null,
    clientNotifiedByEmail: clientUserId === null,
  };
}

export interface PostMessageOpts {
  channelId: string;
  text: string;
  blocks?: unknown[];
}

export async function postMessage(opts: PostMessageOpts): Promise<void> {
  const { channelId, text, blocks } = opts;
  try {
    await slackPost('chat.postMessage', {
      channel: channelId,
      text,
      ...(blocks ? { blocks } : {}),
    });
  } catch (err) {
    console.error('[slack] postMessage failed:', err instanceof Error ? err.message : err);
  }
}

export interface BookingMessageOpts {
  channelId: string;
  consultantName: string;
  clientEmail: string;
  planName: string;
  priceDisplay: string;
  collectionMethod: string;
  txnId: string;
  subscriptionId: number;
}

export interface UsageMessageOpts {
  channelId: string;
  componentName: string;
  unitName: string;
  quantity: number;
  memo?: string;
  txnId: string;
  usageId: number;
}

export interface PlanChangeMessageOpts {
  channelId: string;
  fromPlanName: string;
  toPlanName: string;
  timing: string;
  proratedAdjustmentInCents: number;
  paymentDueInCents: number;
  subscriptionState: string;
  txnId: string;
}

export async function postPlanChangeMessage(opts: PlanChangeMessageOpts): Promise<void> {
  const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
  const adjDisplay =
    opts.proratedAdjustmentInCents === 0
      ? '$0.00'
      : `${opts.proratedAdjustmentInCents < 0 ? '-' : '+'}${fmt(opts.proratedAdjustmentInCents)}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Plan Changed' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*From:*\n${opts.fromPlanName}` },
        { type: 'mrkdwn', text: `*To:*\n${opts.toPlanName}` },
        { type: 'mrkdwn', text: `*Timing:*\n${opts.timing}` },
        { type: 'mrkdwn', text: `*Prorated adjustment:*\n${adjDisplay}` },
        { type: 'mrkdwn', text: `*Payment due:*\n${fmt(opts.paymentDueInCents)}` },
        { type: 'mrkdwn', text: `*Subscription state:*\n${opts.subscriptionState}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Transaction: \`${opts.txnId}\`` }],
    },
  ];

  await postMessage({
    channelId: opts.channelId,
    text: `Plan changed from ${opts.fromPlanName} to ${opts.toPlanName} (${opts.timing})`,
    blocks,
  });
}

export async function postUsageMessage(opts: UsageMessageOpts): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Usage Reported' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Component:*\n${opts.componentName}` },
        { type: 'mrkdwn', text: `*Quantity:*\n${opts.quantity} ${opts.unitName}` },
        { type: 'mrkdwn', text: `*Memo:*\n${opts.memo ?? '(none)'}` },
        { type: 'mrkdwn', text: `*Usage ID:*\n${opts.usageId}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Transaction: \`${opts.txnId}\`` }],
    },
  ];

  await postMessage({
    channelId: opts.channelId,
    text: `Usage reported: ${opts.quantity} ${opts.unitName} of ${opts.componentName}`,
    blocks,
  });
}

export interface LifecycleMessageOpts {
  channelId: string;
  action: string;
  cancelTiming?: string;
  subscriptionState: string;
  subscriptionId: number;
  txnId: string;
}

const ACTION_PAST: Record<string, string> = {
  pause: 'Paused',
  resume: 'Resumed',
  cancel: 'Cancelled',
  reactivate: 'Reactivated',
};

export async function postLifecycleMessage(opts: LifecycleMessageOpts): Promise<void> {
  const label = ACTION_PAST[opts.action] ?? opts.action;
  const actionDetail =
    opts.action === 'cancel' && opts.cancelTiming
      ? `${label} (${opts.cancelTiming})`
      : label;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Subscription ${label}` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Action:*\n${actionDetail}` },
        { type: 'mrkdwn', text: `*Subscription state:*\n${opts.subscriptionState}` },
        { type: 'mrkdwn', text: `*Subscription ID:*\n${opts.subscriptionId}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Transaction: \`${opts.txnId}\`` }],
    },
  ];

  await postMessage({
    channelId: opts.channelId,
    text: `Subscription ${label.toLowerCase()} — state: ${opts.subscriptionState}`,
    blocks,
  });
}

export async function postBookingMessage(opts: BookingMessageOpts): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'New Subscription Booked' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Consultant:*\n${opts.consultantName}` },
        { type: 'mrkdwn', text: `*Client:*\n${opts.clientEmail}` },
        { type: 'mrkdwn', text: `*Plan:*\n${opts.planName}` },
        { type: 'mrkdwn', text: `*Price:*\n${opts.priceDisplay}` },
        { type: 'mrkdwn', text: `*Collection:*\n${opts.collectionMethod}` },
        { type: 'mrkdwn', text: `*Maxio Subscription ID:*\n${opts.subscriptionId}` },
      ],
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `Transaction: \`${opts.txnId}\`` }],
    },
  ];

  await postMessage({
    channelId: opts.channelId,
    text: `New subscription booked for ${opts.clientEmail} — plan: ${opts.planName}`,
    blocks,
  });
}

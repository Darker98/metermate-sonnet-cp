import {
  AuthApi,
  ChatApi,
  ChatPostMessageErrorSchemaError,
  Client,
  ConversationsApi,
  ConversationsCreateErrorSchemaError,
  ConversationsInviteErrorSchema1Error,
  Environment,
  UsersApi,
  ApiError,
  OauthScope,
} from 'slack-apimatic-sdk';
import { config } from '../config.js';
import { transactionStore } from '../stores/transactionStore.js';

const slackClient = new Client({
  authorizationCodeAuthCredentials: {
    oauthClientId: config.slack.oauthClientId,
    oauthClientSecret: config.slack.oauthClientSecret,
    oauthRedirectUri: config.slack.oauthRedirectUri,
    oauthScopes: [
      OauthScope.Channelswrite,
      OauthScope.Groupswrite,
      OauthScope.Imwrite,
      OauthScope.Mpimwrite,
      OauthScope.UsersreadEmail,
      OauthScope.Chatwritebot,
      OauthScope.Chatwriteuser,
    ],
    // Supply the bot token as the pre-obtained OAuth access token so the SDK
    // uses it as the Bearer token without triggering an OAuth exchange flow.
    oauthToken: {
      accessToken: config.slack.botToken,
      expiry: BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365), // arbitrary future expiry time since token is pre-obtained
      expiresIn: BigInt(60 * 60 * 24 * 365),
      tokenType: 'bearer',
    },
  },
  timeout: 30000,
  environment: Environment.Production,
});

const authApi = new AuthApi(slackClient);
const conversationsApi = new ConversationsApi(slackClient);
const usersApi = new UsersApi(slackClient);
const chatApi = new ChatApi(slackClient);

// The SDK defines ok as string but Slack actually returns boolean.
// When that mismatch triggers a ResponseValidationError on an HTTP 200,
// parse the raw body directly rather than failing the call.
async function slackCall<T>(fn: () => Promise<unknown>): Promise<T | null> {
  try {
    const res = (await fn()) as { result?: T };
    return res.result ?? null;
  } catch (err) {
    const e = err as { statusCode?: number; body?: string };
    if (e.statusCode === 200 && typeof e.body === 'string') {
      try {
        return JSON.parse(e.body) as T;
      } catch {
        // body not parseable — fall through to rethrow
      }
    }
    throw err;
  }
}

export async function checkSlackHealth(): Promise<boolean> {
  try {
    const result = await slackCall<{ ok?: unknown }>(() =>
      authApi.authTest(config.slack.botToken)
    );
    return !!result?.ok;
  } catch (err) {
    if (err instanceof ApiError) {
      console.error('[slack] authTest ApiError', err.statusCode, err.body);
    } else {
      console.error('[slack] authTest error:', err instanceof Error ? err.message : err);
    }
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
    const result = await slackCall<{ ok?: unknown; user?: { id?: string } }>(() =>
      usersApi.usersLookupByEmail(config.slack.botToken, email)
    );
    if (result?.ok && result.user?.id) return result.user.id;
    return null;
  } catch {
    return null;
  }
}

async function createPrivateChannel(name: string): Promise<{ id: string; name: string } | null> {
  try {
    const result = await slackCall<{ ok?: unknown; channel?: { id?: string; name?: string } }>(() =>
      conversationsApi.conversationsCreate(config.slack.botToken, name, true)
    );
    if (result?.ok && result.channel?.id && result.channel?.name) {
      return { id: result.channel.id, name: result.channel.name };
    }
    return null;
  } catch (error) {
    if (error instanceof ConversationsCreateErrorSchemaError) {
      const body = error.result as { error?: string } | undefined;
      if (body?.error === 'name_taken') return null;
    }
    throw error;
  }
}

async function inviteUsers(channelId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await slackCall(() =>
      conversationsApi.conversationsInvite(config.slack.botToken, channelId, userIds.join(','))
    );
  } catch (error) {
    if (error instanceof ConversationsInviteErrorSchema1Error) {
      const body = error.result as { error?: string } | undefined;
      if (body?.error === 'already_in_channel') return;
    }
    if (error instanceof ApiError) {
      console.error(`[slack] invite failed for channel ${channelId}:`, error.statusCode, error.body);
      return;
    }
    throw error;
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
    await slackCall(() =>
      chatApi.chatPostMessage(
        config.slack.botToken,
        channelId,
        undefined,              // asUser
        undefined,              // attachments
        blocks ? JSON.stringify(blocks) : undefined, // blocks
        undefined,              // iconEmoji
        undefined,              // iconUrl
        undefined,              // linkNames
        undefined,              // mrkdwn
        undefined,              // parse
        undefined,              // replyBroadcast
        text                    // text
      )
    );
  } catch (error) {
    if (error instanceof ChatPostMessageErrorSchemaError) {
      console.error('[slack] postMessage failed:', error.result);
      return;
    }
    if (error instanceof ApiError) {
      console.error('[slack] postMessage failed:', error.statusCode, error.body);
      return;
    }
    throw error;
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

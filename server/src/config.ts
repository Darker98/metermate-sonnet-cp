import 'dotenv/config';

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val !== undefined && val !== '') return val;
  if (fallback !== undefined) return fallback;
  console.warn(`[config] WARNING: env var "${key}" is not set`);
  return '';
}

export const config = {
  port: parseInt(env('PORT', '4000'), 10),

  maxio: {
    apiKey: env('MAXIO_API_KEY'),
    siteSubdomain: env('MAXIO_SITE_SUBDOMAIN'),
    environment: env('MAXIO_ENVIRONMENT', 'US') as 'US' | 'EU',
    productFamilyId: 3008805,
    productFamilyHandle: 'cp-exp-result-v2',
    apiCallsMetricId: parseInt(env('MAXIO_API_CALLS_METRIC_ID', '0'), 10),
  },

  slack: {
    botToken: env('SLACK_BOT_TOKEN'),
    oauthClientId: env('SLACK_OAUTH_CLIENT_ID', 'placeholder'),
    oauthClientSecret: env('SLACK_OAUTH_CLIENT_SECRET', 'placeholder'),
    oauthRedirectUri: env('SLACK_OAUTH_REDIRECT_URI', 'http://localhost:4000/oauth/callback'),
    digestChannel: env('SLACK_DIGEST_CHANNEL', ''),
  },

  admin: {
    user: env('ADMIN_USER', 'admin'),
    password: env('ADMIN_PASSWORD', 'changeme'),
  },

  session: {
    ttlMinutes: parseInt(env('SESSION_TTL_MINUTES', '30'), 10),
  },

  consultants: [
    {
      id: 'alice',
      name: env('CONSULTANT_1_NAME', 'Alice Chen'),
      email: env('CONSULTANT_1_EMAIL', ''),
    },
    {
      id: 'bob',
      name: env('CONSULTANT_2_NAME', 'Bob Martinez'),
      email: env('CONSULTANT_2_EMAIL', ''),
    },
  ],
} as const;

export type ConsultantConfig = (typeof config.consultants)[number];

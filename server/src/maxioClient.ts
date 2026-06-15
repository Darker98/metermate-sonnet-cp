import { Client, Environment } from '@maxio-com/advanced-billing-sdk';
import { config } from './config.js';

const envMap: Record<string, Environment> = {
  US: Environment.US,
  EU: Environment.EU,
};

export const maxioClient = new Client({
  basicAuthCredentials: {
    username: config.maxio.apiKey,
    password: 'x',
  },
  timeout: 120000,
  environment: envMap[config.maxio.environment] ?? Environment.US,
  site: config.maxio.siteSubdomain,
});

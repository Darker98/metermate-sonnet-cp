import { Router } from 'express';
import { sessionStore } from '../stores/sessionStore.js';
import { transactionStore } from '../stores/transactionStore.js';
import { checkMaxioHealth, productCache, componentCache } from '../services/maxioService.js';
import { checkSlackHealth } from '../services/slackService.js';
import { config } from '../config.js';

export const metaRouter = Router();

metaRouter.get('/health', async (_req, res) => {
  const [maxioOk, slackOk] = await Promise.all([
    checkMaxioHealth(),
    checkSlackHealth(),
  ]);

  res.json({
    status: 'ok',
    sessions: sessionStore.size(),
    transactions: transactionStore.txnCount(),
    maxioSite: config.maxio.siteSubdomain,
    maxioOk,
    slackOk,
  });
});

metaRouter.get('/products', (_req, res) => {
  const products = Array.from(productCache.values()).map((p) => ({
    id: p.id,
    handle: p.handle,
    name: p.name,
    priceInCents: p.priceInCents,
    intervalUnit: p.intervalUnit,
  }));
  res.json({ products });
});

metaRouter.get('/components', (_req, res) => {
  const components = Array.from(componentCache.values()).map((c) => ({
    id: c.id,
    handle: c.handle,
    name: c.name,
    unitName: c.unitName,
    kind: c.kind,
    unitPrice: c.unitPrice,
  }));
  res.json({ components });
});

metaRouter.get('/consultants', (_req, res) => {
  const consultants = config.consultants.map((c) => ({
    id: c.id,
    name: c.name,
  }));
  res.json({ consultants });
});

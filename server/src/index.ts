import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { metaRouter } from './routes/meta.js';
import { bookRouter } from './routes/book.js';
import { usageRouter } from './routes/usage.js';
import { planChangeRouter } from './routes/planChange.js';
import { sessionStore } from './stores/sessionStore.js';
import { loadProductCache, loadComponentCache, productCache } from './services/maxioService.js';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', metaRouter);
app.use('/api', bookRouter);
app.use('/api', usageRouter);
app.use('/api', planChangeRouter);

async function bootstrap(): Promise<void> {
  await Promise.all([loadProductCache(), loadComponentCache()]);

  setInterval(() => sessionStore.sweep(), 5 * 60 * 1000);

  app.listen(config.port, () => {
    console.log(`MeterMate server listening on http://localhost:${config.port}`);
    console.log(`  /api/health     → server + Maxio + Slack status`);
    console.log(`  /api/products   → ${productCache.size} products loaded`);
    console.log(`  /api/consultants → ${config.consultants.length} consultants`);
  });
}

bootstrap().catch((err) => {
  console.error('[server] Bootstrap failed:', err);
  process.exit(1);
});

export { app };

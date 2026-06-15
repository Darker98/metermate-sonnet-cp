import 'dotenv/config';
import {
  Client,
  Environment,
  ProductsController,
  ProductFamiliesController,
  ComponentsController,
  CreateOrUpdateProductRequest,
  CreateMeteredComponent,
  CreateEBBComponent,
  IntervalUnit,
  PricingScheme,
  ApiError,
  ErrorListResponseError,
} from '@maxio-com/advanced-billing-sdk';

const apiKey = process.env.MAXIO_API_KEY ?? '';
const siteSubdomain = process.env.MAXIO_SITE_SUBDOMAIN ?? '';
const environment = (process.env.MAXIO_ENVIRONMENT ?? 'US') as 'US' | 'EU';
const apiCallsMetricId = parseInt(process.env.MAXIO_API_CALLS_METRIC_ID ?? '0', 10);
const productFamilyId = 3008805;

if (!apiKey || !siteSubdomain) {
  console.error('[seed] ERROR: MAXIO_API_KEY and MAXIO_SITE_SUBDOMAIN must be set in .env');
  process.exit(1);
}

const client = new Client({
  basicAuthCredentials: { username: apiKey, password: 'x' },
  timeout: 120000,
  environment: environment === 'EU' ? Environment.EU : Environment.US,
  site: siteSubdomain,
});

const productsCtrl = new ProductsController(client);
const productFamiliesCtrl = new ProductFamiliesController(client);
const componentsCtrl = new ComponentsController(client);

async function ensureProduct(
  handle: string,
  name: string,
  priceInCents: bigint,
  description: string
): Promise<number> {
  try {
    const existing = await productsCtrl.readProductByHandle(handle);
    const id = existing.result?.product?.id;
    if (id !== undefined) {
      console.log(`  ✔ Product "${handle}" already exists (id: ${id})`);
      return id;
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.statusCode === 404)) throw err;
  }

  const body: CreateOrUpdateProductRequest = {
    product: {
      name,
      description,
      handle,
      priceInCents,
      interval: 1,
      intervalUnit: IntervalUnit.Month,
      requireCreditCard: false,
    },
  };

  try {
    const response = await productsCtrl.createProduct(String(productFamilyId), body);
    const id = response.result?.product?.id;
    if (id === undefined) throw new Error(`createProduct returned no id for handle "${handle}"`);
    console.log(`  ✔ Created product "${handle}" (id: ${id}, price: $${Number(priceInCents) / 100}/mo)`);
    return id;
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      console.error(`  ✗ createProduct "${handle}" failed:`, err.result);
    }
    throw err;
  }
}

async function ensureMeteredComponent(
  handle: string,
  name: string,
  unitName: string,
  unitPrice: string
): Promise<number> {
  try {
    const existing = await componentsCtrl.readComponent(
      productFamilyId,
      `handle:${handle}`
    );
    const id = existing.result?.component?.id;
    if (id !== undefined) {
      console.log(`  ✔ Metered component "${handle}" already exists (id: ${id})`);
      return id;
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.statusCode === 404)) throw err;
  }

  const body: CreateMeteredComponent = {
    meteredComponent: {
      name,
      unitName,
      handle,
      pricingScheme: PricingScheme.PerUnit,
      taxable: false,
      prices: [{ startingQuantity: 1, unitPrice }],
    },
  };

  try {
    const response = await componentsCtrl.createMeteredComponent(String(productFamilyId), body);
    const id = response.result?.component?.id;
    if (id === undefined) throw new Error(`createMeteredComponent returned no id for "${handle}"`);
    console.log(`  ✔ Created metered component "${handle}" (id: ${id}, $${unitPrice}/${unitName})`);
    return id;
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      console.error(`  ✗ createMeteredComponent "${handle}" failed:`, err.result);
    }
    throw err;
  }
}

async function ensureEbbComponent(
  handle: string,
  name: string,
  unitName: string,
  unitPrice: string,
  metricId: number
): Promise<number> {
  try {
    const existing = await componentsCtrl.readComponent(
      productFamilyId,
      `handle:${handle}`
    );
    const id = existing.result?.component?.id;
    if (id !== undefined) {
      console.log(`  ✔ EBB component "${handle}" already exists (id: ${id})`);
      return id;
    }
  } catch (err) {
    if (!(err instanceof ApiError && err.statusCode === 404)) throw err;
  }

  const body: CreateEBBComponent = {
    eventBasedComponent: {
      name,
      unitName,
      handle,
      pricingScheme: PricingScheme.PerUnit,
      eventBasedBillingMetricId: metricId,
      taxable: false,
      prices: [{ startingQuantity: 1, unitPrice }],
    },
  };

  try {
    const response = await componentsCtrl.createEventBasedComponent(String(productFamilyId), body);
    const id = response.result?.component?.id;
    if (id === undefined) throw new Error(`createEventBasedComponent returned no id for "${handle}"`);
    console.log(`  ✔ Created EBB component "${handle}" (id: ${id}, $${unitPrice}/${unitName})`);
    return id;
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      console.error(`  ✗ createEventBasedComponent "${handle}" failed:`, err.result);
    }
    throw err;
  }
}

async function verifyProductFamily(): Promise<void> {
  try {
    const response = await productFamiliesCtrl.readProductFamily(productFamilyId);
    const name = response.result?.productFamily?.name ?? '(unknown)';
    console.log(`[seed] Product family verified: "${name}" (id: ${productFamilyId})\n`);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      console.error(`[seed] ERROR: Product family id ${productFamilyId} not found on site "${siteSubdomain}".`);
      console.error(`  Make sure MAXIO_SITE_SUBDOMAIN and MAXIO_ENVIRONMENT are correct.`);
    }
    throw err;
  }
}

async function seed(): Promise<void> {
  console.log(`\n[seed] Targeting Maxio site: ${siteSubdomain} (${environment})\n`);

  await verifyProductFamily();

  console.log('[seed] Products:');
  await ensureProduct('mm-basic', 'Basic Plan', BigInt(9900), 'Flat monthly retainer — Basic ($99/mo)');
  await ensureProduct('mm-pro', 'Pro Plan', BigInt(29900), 'Flat monthly retainer — Pro ($299/mo)');

  console.log('\n[seed] Components:');
  await ensureMeteredComponent(
    'mm-consult-mins',
    'Consulting Minutes',
    'minute',
    '2.00'
  );

  if (!apiCallsMetricId) {
    console.warn(`
  ⚠ MAXIO_API_CALLS_METRIC_ID is not set — skipping mm-api-calls EBB component.

  To create it:
    1. Log in to your Maxio test site → Settings → Event-Based Billing → New Metric.
    2. Name: "API Calls", unit name: "api call".
    3. Copy the numeric metric ID Maxio assigns.
    4. Add MAXIO_API_CALLS_METRIC_ID=<id> to your .env, then re-run: npm run seed
`);
  } else {
    await ensureEbbComponent(
      'mm-api-calls',
      'API Calls',
      'api call',
      '0.01',
      apiCallsMetricId
    );
  }

  console.log('\n[seed] ✔ Done!\n');
  console.log('Product handles for the UC1 form:');
  console.log('  mm-basic  → $99/month');
  console.log('  mm-pro    → $299/month');
  console.log('Component handles for the UC2 form:');
  console.log('  mm-consult-mins → $2.00/minute (metered)');
  if (apiCallsMetricId) {
    console.log('  mm-api-calls    → $0.01/event  (EBB)');
  }
}

seed().catch((err) => {
  console.error('[seed] Fatal error:', err instanceof Error ? err.message : err);
  process.exit(1);
});

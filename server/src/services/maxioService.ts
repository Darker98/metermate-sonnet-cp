import {
  ProductFamiliesController,
  ComponentsController,
  SubscriptionsController,
  SubscriptionComponentsController,
  SubscriptionProductsController,
  SubscriptionStatusController,
  InvoicesController,
  ApiError,
  CollectionMethod as MaxioCollectionMethod,
  ErrorListResponseError,
  ErrorArrayMapResponseError,
  Direction,
} from '@maxio-com/advanced-billing-sdk';
import type {
  CreateSubscriptionRequest,
  CreateUsageRequest,
  SubscriptionMigrationPreviewRequest,
  SubscriptionProductMigrationRequest,
  CancellationRequest,
  ReactivateSubscriptionRequest,
  PauseRequest,
  CreateInvoiceRequest,
  SendInvoiceRequest,
} from '@maxio-com/advanced-billing-sdk';
import { maxioClient } from '../maxioClient.js';
import { config } from '../config.js';
import type { ProductInfo, ComponentInfo } from '../types.js';

export const productFamiliesCtrl = new ProductFamiliesController(maxioClient);
export const componentsCtrl = new ComponentsController(maxioClient);
export const subscriptionsCtrl = new SubscriptionsController(maxioClient);
export const subscriptionComponentsCtrl = new SubscriptionComponentsController(maxioClient);
export const subscriptionProductsCtrl = new SubscriptionProductsController(maxioClient);
export const subscriptionStatusCtrl = new SubscriptionStatusController(maxioClient);
export const invoicesCtrl = new InvoicesController(maxioClient);

export const productCache = new Map<string, ProductInfo>();
export const componentCache = new Map<string, ComponentInfo>();

export async function loadProductCache(): Promise<void> {
  try {
    const response = await productFamiliesCtrl.listProductsForProductFamily({
      productFamilyId: String(config.maxio.productFamilyId),
      perPage: 50,
    });

    if (response.result) {
      for (const item of response.result) {
        const p = item.product;
        if (p?.handle && p.id !== undefined) {
          productCache.set(p.handle, {
            id: p.id,
            handle: p.handle,
            name: p.name ?? p.handle,
            priceInCents: p.priceInCents !== undefined ? Number(p.priceInCents) : 0,
            intervalUnit: p.intervalUnit ?? 'month',
          });
        }
      }
    }
    console.log(`[maxio] Loaded ${productCache.size} product(s) into cache`);
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn(`[maxio] Could not load product cache (HTTP ${err.statusCode}):`, err.body);
    } else {
      console.warn('[maxio] Could not load product cache:', err instanceof Error ? err.message : err);
    }
  }
}

export async function loadComponentCache(): Promise<void> {
  try {
    const response = await componentsCtrl.listComponentsForProductFamily({
      productFamilyId: config.maxio.productFamilyId,
      perPage: 50,
    });

    if (response.result) {
      for (const item of response.result) {
        const c = item.component;
        if (c?.handle && c.id !== undefined) {
          componentCache.set(c.handle, {
            id: c.id,
            handle: c.handle,
            name: c.name ?? c.handle,
            unitName: c.unitName ?? 'unit',
            kind: c.kind ?? 'metered_component',
            unitPrice: c.unitPrice !== undefined ? String(c.unitPrice) : undefined,
          });
        }
      }
    }
    console.log(`[maxio] Loaded ${componentCache.size} component(s) into cache`);
  } catch (err) {
    if (err instanceof ApiError) {
      console.warn(`[maxio] Could not load component cache (HTTP ${err.statusCode}):`, err.body);
    } else {
      console.warn('[maxio] Could not load component cache:', err instanceof Error ? err.message : err);
    }
  }
}

export async function checkMaxioHealth(): Promise<boolean> {
  try {
    await productFamiliesCtrl.readProductFamily(config.maxio.productFamilyId);
    return true;
  } catch {
    return false;
  }
}

export interface CreateSubscriptionParams {
  productHandle: string;
  clientEmail: string;
  clientFirstName: string;
  clientLastName: string;
  companyName?: string;
  collectionMethod: 'automatic' | 'remittance';
}

export interface SubscriptionResult {
  subscriptionId: number;
  state: string;
  customerId: number;
}

export async function createSubscription(params: CreateSubscriptionParams): Promise<SubscriptionResult> {
  const body: CreateSubscriptionRequest = {
    subscription: {
      productHandle: params.productHandle,
      paymentCollectionMethod:
        params.collectionMethod === 'automatic'
          ? MaxioCollectionMethod.Automatic
          : MaxioCollectionMethod.Remittance,
      customerAttributes: {
        firstName: params.clientFirstName,
        lastName: params.clientLastName,
        email: params.clientEmail,
        organization: params.companyName,
      },
    },
  };

  try {
    const response = await subscriptionsCtrl.createSubscription(body);
    const sub = response.result?.subscription;

    if (!sub?.id || !sub.state || sub.customer?.id === undefined) {
      throw new Error('[maxio] createSubscription returned incomplete subscription data');
    }

    return {
      subscriptionId: sub.id,
      state: String(sub.state),
      customerId: sub.customer.id,
    };
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      const messages =
        (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Subscription validation failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] createSubscription failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export interface ReportUsageParams {
  subscriptionId: number;
  componentId: number;
  quantity: number;
  memo?: string;
}

export interface UsageResult {
  usageId: number;
  quantity: number;
  componentId: number;
  componentHandle?: string;
}

export async function reportUsage(params: ReportUsageParams): Promise<UsageResult> {
  const body: CreateUsageRequest = {
    usage: {
      quantity: params.quantity,
      ...(params.memo ? { memo: params.memo } : {}),
    },
  };

  try {
    const response = await subscriptionComponentsCtrl.createUsage(
      params.subscriptionId,
      params.componentId,
      body
    );

    const usage = response.result?.usage;
    if (!usage?.id) {
      throw new Error('[maxio] createUsage returned no usage object');
    }

    return {
      usageId: Number(usage.id),
      quantity: typeof usage.quantity === 'number' ? usage.quantity : params.quantity,
      componentId: usage.componentId !== undefined ? Number(usage.componentId) : params.componentId,
      componentHandle: usage.componentHandle ?? undefined,
    };
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      const messages =
        (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Usage validation failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] createUsage failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export interface SubscriptionInfo {
  id: number;
  state: string;
  productId: number;
  productHandle: string;
  productName: string;
}

export async function readSubscription(subscriptionId: number): Promise<SubscriptionInfo> {
  const response = await subscriptionsCtrl.readSubscription(subscriptionId);
  const sub = response.result?.subscription;
  if (!sub?.id || !sub.state || !sub.product?.id) {
    throw new Error('[maxio] readSubscription returned incomplete data');
  }
  return {
    id: Number(sub.id),
    state: String(sub.state),
    productId: sub.product.id,
    productHandle: sub.product.handle ?? '',
    productName: sub.product.name ?? '',
  };
}

export interface PlanChangePreviewResult {
  proratedAdjustmentInCents: number;
  chargeInCents: number;
  paymentDueInCents: number;
  creditAppliedInCents: number;
}

export async function previewPlanChange(
  subscriptionId: number,
  newProductHandle: string
): Promise<PlanChangePreviewResult> {
  const body: SubscriptionMigrationPreviewRequest = {
    migration: {
      productHandle: newProductHandle,
      includeTrial: false,
      includeInitialCharge: false,
      includeCoupons: true,
      preservePeriod: true,
    },
  };

  try {
    const response = await subscriptionProductsCtrl.previewSubscriptionProductMigration(
      subscriptionId,
      body
    );

    const preview = response.result?.migration;
    if (!preview) {
      throw new Error('[maxio] previewSubscriptionProductMigration returned no migration data');
    }

    return {
      proratedAdjustmentInCents: Number(preview.proratedAdjustmentInCents ?? 0),
      chargeInCents: Number(preview.chargeInCents ?? 0),
      paymentDueInCents: Number(preview.paymentDueInCents ?? 0),
      creditAppliedInCents: Number(preview.creditAppliedInCents ?? 0),
    };
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      const messages = (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Plan change preview failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] previewPlanChange failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export interface ExecutePlanChangeParams {
  subscriptionId: number;
  newProductId: number;
  timing: 'prorate' | 'at-renewal';
}

export interface ExecutePlanChangeResult {
  subscriptionId: number;
  state: string;
  newProductName: string;
  newProductId: number;
}

export interface LifecycleParams {
  subscriptionId: number;
  action: 'pause' | 'resume' | 'cancel' | 'reactivate';
  cancelTiming?: 'immediate' | 'end-of-period';
}

export interface LifecycleResult {
  subscriptionId: number;
  state: string;
}

export async function performLifecycleAction(params: LifecycleParams): Promise<LifecycleResult> {
  const { subscriptionId, action, cancelTiming } = params;

  try {
    let state: string;

    switch (action) {
      case 'pause': {
        const pauseBody: PauseRequest = {};
        const response = await subscriptionStatusCtrl.pauseSubscription(subscriptionId, pauseBody);
        const sub = response.result?.subscription;
        if (!sub?.state) throw new Error('[maxio] pauseSubscription returned no subscription state');
        state = String(sub.state);
        break;
      }
      case 'resume': {
        const response = await subscriptionStatusCtrl.resumeSubscription(subscriptionId);
        const sub = response.result?.subscription;
        if (!sub?.state) throw new Error('[maxio] resumeSubscription returned no subscription state');
        state = String(sub.state);
        break;
      }
      case 'cancel': {
        const cancelBody: CancellationRequest = {
          subscription: {
            cancelAtEndOfPeriod: cancelTiming !== 'immediate',
          },
        };
        const response = await subscriptionStatusCtrl.cancelSubscription(subscriptionId, cancelBody);
        const sub = response.result?.subscription;
        if (!sub?.state) throw new Error('[maxio] cancelSubscription returned no subscription state');
        state = String(sub.state);
        break;
      }
      case 'reactivate': {
        const reactivateBody: ReactivateSubscriptionRequest = {};
        const response = await subscriptionStatusCtrl.reactivateSubscription(subscriptionId, reactivateBody);
        const sub = response.result?.subscription;
        if (!sub?.state) throw new Error('[maxio] reactivateSubscription returned no subscription state');
        state = String(sub.state);
        break;
      }
      default: {
        const _exhaustive: never = action;
        throw new Error(`[maxio] Unknown lifecycle action: ${String(_exhaustive)}`);
      }
    }

    return { subscriptionId, state };
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      const messages = (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Lifecycle '${action}' failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] Lifecycle '${action}' failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export async function executePlanChange(
  params: ExecutePlanChangeParams
): Promise<ExecutePlanChangeResult> {
  const body: SubscriptionProductMigrationRequest = {
    migration: {
      productId: params.newProductId,
      includeTrial: false,
      includeInitialCharge: false,
      includeCoupons: true,
      preservePeriod: params.timing === 'prorate',
    },
  };

  try {
    const response = await subscriptionProductsCtrl.migrateSubscriptionProduct(
      params.subscriptionId,
      body
    );

    const sub = response.result?.subscription;
    if (!sub?.id || !sub.state) {
      throw new Error('[maxio] migrateSubscriptionProduct returned incomplete subscription data');
    }

    return {
      subscriptionId: Number(sub.id),
      state: String(sub.state),
      newProductName: sub.product?.name ?? '',
      newProductId: sub.product?.id ?? params.newProductId,
    };
  } catch (err) {
    if (err instanceof ErrorListResponseError) {
      const messages = (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Plan change failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] executePlanChange failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export interface InvoiceLineItem {
  title: string;
  quantity: number;
  unitPrice: string;
}

export interface IssueInvoiceParams {
  subscriptionId: number;
  clientEmail: string;
  lineItems: InvoiceLineItem[];
}

export interface IssueInvoiceResult {
  invoiceUid: string;
  invoiceNumber: string;
  dueAmount: string;
  totalAmount: string;
  dueDate: string;
  issueDate: string;
  invoiceStatus: string;
}

export async function issueAndSendInvoice(params: IssueInvoiceParams): Promise<IssueInvoiceResult> {
  try {
    const createBody: CreateInvoiceRequest = {
      invoice: {
        lineItems: params.lineItems.map((item) => ({
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      },
    };

    // createInvoice immediately creates an open ad-hoc invoice — no issueInvoice needed
    // (issueInvoice is only for pending invoices from Maxio's billing cycle)
    const createResponse = await invoicesCtrl.createInvoice(params.subscriptionId, createBody);
    const invoiceUid = createResponse.result?.invoice?.uid;
    if (!invoiceUid) {
      throw new Error('[maxio] createInvoice returned no invoice UID');
    }

    const sendBody: SendInvoiceRequest = {
      recipientEmails: [params.clientEmail],
    };
    await invoicesCtrl.sendInvoice(invoiceUid, sendBody);

    const readResponse = await invoicesCtrl.readInvoice(invoiceUid);
    const inv = readResponse.result;
    if (!inv) {
      throw new Error('[maxio] readInvoice returned no invoice');
    }

    return {
      invoiceUid,
      invoiceNumber: inv.number ?? '',
      dueAmount: inv.dueAmount ?? '0.00',
      totalAmount: inv.totalAmount ?? '0.00',
      dueDate: inv.dueDate ?? '',
      issueDate: inv.issueDate ?? '',
      invoiceStatus: String(inv.status ?? 'open'),
    };
  } catch (err) {
    if (err instanceof ErrorArrayMapResponseError) {
      throw new Error(`[maxio] Invoice operation failed: ${JSON.stringify(err.result)}`);
    }
    if (err instanceof ErrorListResponseError) {
      const messages = (err.result as { errors?: string[] } | undefined)?.errors ?? [];
      throw new Error(`[maxio] Invoice operation failed: ${messages.join('; ')}`);
    }
    if (err instanceof ApiError) {
      throw new Error(`[maxio] Invoice operation failed (HTTP ${err.statusCode}): ${String(err.body)}`);
    }
    throw err;
  }
}

export interface DigestSubscriptionStats {
  total: number;
  active: number;
  onHold: number;
  canceled: number;
  other: number;
}

export interface DigestInvoiceSummary {
  number: string;
  status: string;
  totalAmount: string;
  customerEmail: string;
  dueDate: string;
}

export interface DigestInvoiceStats {
  total: number;
  open: number;
  paid: number;
  totalAmountSum: string;
  recent: DigestInvoiceSummary[];
}

export interface BillingDigestData {
  subscriptions: DigestSubscriptionStats;
  invoices: DigestInvoiceStats;
}

export async function fetchBillingDigest(): Promise<BillingDigestData> {
  const [subResponse, invResponse] = await Promise.all([
    subscriptionsCtrl.listSubscriptions({ page: 1, perPage: 200 }),
    invoicesCtrl.listInvoices({ page: 1, perPage: 50, direction: Direction.Desc }),
  ]);

  // — subscriptions —
  const subStats: DigestSubscriptionStats = { total: 0, active: 0, onHold: 0, canceled: 0, other: 0 };
  for (const wrapper of subResponse.result ?? []) {
    const state = String(wrapper.subscription?.state ?? '');
    subStats.total++;
    if (state === 'active') subStats.active++;
    else if (state === 'canceled') subStats.canceled++;
    else if (state === 'on_hold') subStats.onHold++;
    else subStats.other++;
  }

  // — invoices —
  const rawInvoices = invResponse.result?.invoices ?? [];
  let totalAmountSum = 0;
  let openCount = 0;
  let paidCount = 0;
  const recent: DigestInvoiceSummary[] = [];

  for (const inv of rawInvoices) {
    if (!inv) continue;
    const status = String(inv.status ?? '');
    if (status === 'open') openCount++;
    else if (status === 'paid') paidCount++;
    totalAmountSum += parseFloat(inv.totalAmount ?? '0') || 0;
    if (recent.length < 5) {
      recent.push({
        number: inv.number ?? '',
        status,
        totalAmount: inv.totalAmount ?? '0.00',
        customerEmail: inv.customer?.email ?? '',
        dueDate: inv.dueDate ?? '',
      });
    }
  }

  const invStats: DigestInvoiceStats = {
    total: rawInvoices.length,
    open: openCount,
    paid: paidCount,
    totalAmountSum: totalAmountSum.toFixed(2),
    recent,
  };

  return { subscriptions: subStats, invoices: invStats };
}

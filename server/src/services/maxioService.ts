import {
  ProductFamiliesController,
  ComponentsController,
  SubscriptionsController,
  SubscriptionComponentsController,
  ApiError,
  CollectionMethod as MaxioCollectionMethod,
  ErrorListResponseError,
} from '@maxio-com/advanced-billing-sdk';
import type {
  CreateSubscriptionRequest,
  CreateUsageRequest,
} from '@maxio-com/advanced-billing-sdk';
import { maxioClient } from '../maxioClient.js';
import { config } from '../config.js';
import type { ProductInfo, ComponentInfo } from '../types.js';

export const productFamiliesCtrl = new ProductFamiliesController(maxioClient);
export const componentsCtrl = new ComponentsController(maxioClient);
export const subscriptionsCtrl = new SubscriptionsController(maxioClient);
export const subscriptionComponentsCtrl = new SubscriptionComponentsController(maxioClient);

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

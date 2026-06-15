import {
  ProductFamiliesController,
  ComponentsController,
  ApiError,
} from '@maxio-com/advanced-billing-sdk';
import { maxioClient } from '../maxioClient.js';
import { config } from '../config.js';
import type { ProductInfo, ComponentInfo } from '../types.js';

export const productFamiliesCtrl = new ProductFamiliesController(maxioClient);
export const componentsCtrl = new ComponentsController(maxioClient);

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

// Thin client over the CE-408 ALB API. The endpoints, methods, bodies and
// response shapes are an exact mirror of the existing backend contract -
// nothing here changes server behaviour.
//
//   GET    /catalog/products
//   GET    /catalog/products/{sku}
//   GET    /cart/sessions/{userId}
//   POST   /cart/sessions/{userId}/items          { sku, qty }
//   PUT    /cart/sessions/{userId}/items/{sku}     { qty }
//   DELETE /cart/sessions/{userId}
//   POST   /orders                                { userId, items }

import { API_BASE } from "./config";

export interface Product {
  id: number;
  sku: string;
  name: string;
  price_cents: number;
  inventory: number;
}

export interface CartLine {
  sku: string;
  qty: number;
}

export interface Cart {
  userId: string;
  items: CartLine[];
}

export interface OrderResult {
  orderId: number;
  total_cents: number;
  status: string;
}

class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_BASE) throw new ApiError("API endpoint is not configured.");
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (e) {
    throw new ApiError(
      e instanceof Error ? `Network error: ${e.message}` : "Network error",
    );
  }
  if (!res.ok) throw new ApiError(`Request failed (${res.status})`);
  // DELETE returns a small JSON body; everything else is JSON too.
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Returns the catalog plus the round-trip latency in ms (for the live status strip). */
export async function getProducts(): Promise<{ products: Product[]; latencyMs: number }> {
  const t0 = performance.now();
  const products = await request<Product[]>("/catalog/products");
  return { products, latencyMs: Math.round(performance.now() - t0) };
}

export function getProduct(sku: string): Promise<Product> {
  return request<Product>(`/catalog/products/${encodeURIComponent(sku)}`);
}

export function getCart(userId: string): Promise<Cart> {
  return request<Cart>(`/cart/sessions/${encodeURIComponent(userId)}`);
}

export function addCartItem(userId: string, sku: string, qty = 1) {
  return request(
    `/cart/sessions/${encodeURIComponent(userId)}/items`,
    json({ sku, qty }),
  );
}

export function setCartItem(userId: string, sku: string, qty: number) {
  return request(
    `/cart/sessions/${encodeURIComponent(userId)}/items/${encodeURIComponent(sku)}`,
    { ...json({ qty }), method: "PUT" },
  );
}

export function clearCart(userId: string) {
  return request(`/cart/sessions/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export function placeOrder(userId: string, items: CartLine[]) {
  return request<OrderResult>("/orders", json({ userId, items }));
}

export { ApiError };

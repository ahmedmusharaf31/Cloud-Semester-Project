// Visual metadata for products.
//
// The catalog API has no image column and the backend must not change, so
// imagery is resolved entirely on the client. Strategy:
//
//   1. Exact SKU match   - hand-picked photo for the seeded catalog.
//   2. Keyword match     - infer a category from the product name so brand-new
//                          SKUs added to the DB still get a sensible photo.
//   3. Generated tile    - a deterministic gradient + monogram, used as the
//                          onError fallback if a photo ever fails to load.
//
// This keeps the storefront fully dynamic: change the catalog rows and the UI
// follows along without a code change.

import type { Product } from "./api";

const U = (id: string, w = 1100) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;

// Category -> photo. Keyword-matched against the product name.
const CATEGORY_PHOTOS: Record<string, string> = {
  mouse: U("photo-1527864550417-7fd91fc51a46"),
  keyboard: U("photo-1587829741301-dc798b83add3"),
  hub: U("photo-1601524909162-ae8725290836"),
  adapter: U("photo-1601524909162-ae8725290836"),
  cable: U("photo-1558756520-22cfe5d382ca"),
  charger: U("photo-1583863788434-e58a36330cf0"),
  headphone: U("photo-1505740420928-5e560c06d30e"),
  earbud: U("photo-1572569511254-d8f925fe2cbb"),
  speaker: U("photo-1608043152269-423dbba4e7e1"),
  monitor: U("photo-1527443224154-c4a3942d3acf"),
  webcam: U("photo-1587826080692-f439cd0b70da"),
  laptop: U("photo-1496181133206-80ce9b88a853"),
  watch: U("photo-1523275335684-37898b6baf30"),
  drive: U("photo-1531492746076-161ca9bcad58"),
  stand: U("photo-1616627561839-074385245ff6"),
  pad: U("photo-1616627561839-074385245ff6"),
  pen: U("photo-1583485088034-697b5bc54ccd"),
  light: U("photo-1565814329452-e1efa11c5b89"),
};

// Exact SKU overrides for the seeded catalog.
const SKU_PHOTOS: Record<string, string> = {
  "SKU-001": CATEGORY_PHOTOS.mouse,
  "SKU-002": CATEGORY_PHOTOS.hub,
  "SKU-003": CATEGORY_PHOTOS.keyboard,
  "SKU-004": CATEGORY_PHOTOS.headphone,
  "SKU-005": CATEGORY_PHOTOS.speaker,
  "SKU-006": CATEGORY_PHOTOS.webcam,
  "SKU-007": CATEGORY_PHOTOS.monitor,
  "SKU-008": CATEGORY_PHOTOS.drive,
  "SKU-009": CATEGORY_PHOTOS.stand,
  "SKU-010": CATEGORY_PHOTOS.charger,
};

const GRADIENTS = [
  ["#7b1d2e", "#c44a60"],
  ["#1e3a8a", "#3b82f6"],
  ["#166534", "#22c55e"],
  ["#713f12", "#d97706"],
  ["#581c87", "#a855f7"],
  ["#0e7490", "#06b6d4"],
];

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

/** Deterministic gradient pair for a SKU - used by the generated fallback tile. */
export function gradientFor(sku: string): [string, string] {
  return GRADIENTS[hash(sku) % GRADIENTS.length] as [string, string];
}

/** First letter of the product name, for the monogram fallback. */
export function monogram(name: string): string {
  const m = name.match(/[A-Za-z0-9]/);
  return (m ? m[0] : "?").toUpperCase();
}

/** Best-effort photo URL for a product, or null to use the generated tile. */
export function photoFor(product: Pick<Product, "sku" | "name">): string | null {
  if (SKU_PHOTOS[product.sku]) return SKU_PHOTOS[product.sku];
  const name = product.name.toLowerCase();
  for (const keyword of Object.keys(CATEGORY_PHOTOS)) {
    if (name.includes(keyword)) return CATEGORY_PHOTOS[keyword];
  }
  return null;
}

/** A short, human category tag derived from the product name. */
export function categoryFor(product: Pick<Product, "name">): string {
  const name = product.name.toLowerCase();
  for (const keyword of Object.keys(CATEGORY_PHOTOS)) {
    if (name.includes(keyword)) {
      return keyword.charAt(0).toUpperCase() + keyword.slice(1);
    }
  }
  return "Accessory";
}

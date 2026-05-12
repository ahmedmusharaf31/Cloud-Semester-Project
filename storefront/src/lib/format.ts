/** price_cents (integer) -> "$24.99" */
export function money(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}

export type StockLevel = "out" | "low" | "in";

export function stockLevel(inventory: number): StockLevel {
  if (inventory <= 0) return "out";
  if (inventory < 10) return "low";
  return "in";
}

export function stockLabel(inventory: number): string {
  if (inventory <= 0) return "Sold out";
  if (inventory < 10) return `Only ${inventory} left`;
  return "In stock";
}

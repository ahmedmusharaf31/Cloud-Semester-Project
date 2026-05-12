import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  addCartItem,
  clearCart as apiClearCart,
  getCart,
  getProducts,
  placeOrder,
  setCartItem,
  type CartLine,
  type OrderResult,
  type Product,
} from "../lib/api";
import { USER_ID } from "../lib/user";
import { useToast } from "./toast";

export interface CartEntry extends CartLine {
  product?: Product;
  lineTotalCents: number;
}

interface CartApi {
  lines: CartEntry[];
  products: Product[];
  count: number;
  subtotalCents: number;
  loading: boolean;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  add: (sku: string, qty?: number) => Promise<void>;
  setQty: (sku: string, qty: number) => Promise<void>;
  remove: (sku: string) => Promise<void>;
  clear: () => Promise<void>;
  checkout: () => Promise<OrderResult | null>;
  productBySku: (sku: string) => Product | undefined;
}

const CartContext = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [rawLines, setRawLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const productMap = useMemo(() => {
    const m = new Map<string, Product>();
    for (const p of products) m.set(p.sku, p);
    return m;
  }, [products]);

  const reloadCart = useCallback(async () => {
    try {
      const cart = await getCart(USER_ID);
      setRawLines(cart.items ?? []);
    } catch {
      setRawLines([]);
    }
  }, []);

  const reloadProducts = useCallback(async () => {
    try {
      const { products: p } = await getProducts();
      setProducts(p);
    } catch {
      /* products are best-effort here; pages surface their own errors */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await Promise.all([reloadProducts(), reloadCart()]);
      if (alive) setLoading(false);
    })();
    // keep the cart fresh, mirroring the original 15s poll
    const t = window.setInterval(reloadCart, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [reloadCart, reloadProducts]);

  const add = useCallback(
    async (sku: string, qty = 1) => {
      try {
        await addCartItem(USER_ID, sku, qty);
        await reloadCart();
        toast("Added to bag", "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not add item", "error");
      }
    },
    [reloadCart, toast],
  );

  const setQty = useCallback(
    async (sku: string, qty: number) => {
      const next = Math.max(0, qty);
      // optimistic update for a snappy feel
      setRawLines((prev) =>
        next === 0
          ? prev.filter((l) => l.sku !== sku)
          : prev.map((l) => (l.sku === sku ? { ...l, qty: next } : l)),
      );
      try {
        await setCartItem(USER_ID, sku, next);
        await reloadCart();
      } catch (e) {
        await reloadCart();
        toast(e instanceof Error ? e.message : "Update failed", "error");
      }
    },
    [reloadCart, toast],
  );

  const remove = useCallback(
    async (sku: string) => {
      await setQty(sku, 0);
      toast("Removed from bag");
    },
    [setQty, toast],
  );

  const clear = useCallback(async () => {
    try {
      await apiClearCart(USER_ID);
    } finally {
      await reloadCart();
    }
  }, [reloadCart]);

  const checkout = useCallback(async (): Promise<OrderResult | null> => {
    if (rawLines.length === 0) return null;
    try {
      const result = await placeOrder(USER_ID, rawLines);
      await apiClearCart(USER_ID);
      await reloadCart();
      return result;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Checkout failed", "error");
      return null;
    }
  }, [rawLines, reloadCart, toast]);

  const lines = useMemo<CartEntry[]>(
    () =>
      rawLines.map((l) => {
        const product = productMap.get(l.sku);
        return {
          ...l,
          product,
          lineTotalCents: (product?.price_cents ?? 0) * l.qty,
        };
      }),
    [rawLines, productMap],
  );

  const count = useMemo(
    () => rawLines.reduce((s, l) => s + l.qty, 0),
    [rawLines],
  );
  const subtotalCents = useMemo(
    () => lines.reduce((s, l) => s + l.lineTotalCents, 0),
    [lines],
  );

  const value: CartApi = {
    lines,
    products,
    count,
    subtotalCents,
    loading,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    add,
    setQty,
    remove,
    clear,
    checkout,
    productBySku: (sku) => productMap.get(sku),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCart(): CartApi {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useCart } from "../state/cart";
import { money } from "../lib/format";
import ProductImage from "./ProductImage";

export default function CartDrawer() {
  const {
    drawerOpen,
    closeDrawer,
    lines,
    count,
    subtotalCents,
    setQty,
    remove,
  } = useCart();
  const navigate = useNavigate();

  const go = (path: string) => {
    closeDrawer();
    navigate(path);
  };

  return (
    <AnimatePresence>
      {drawerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeDrawer}
            className="fixed inset-0 z-[140] bg-maroon-950/50 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-y-0 right-0 z-[150] flex w-full max-w-md flex-col bg-cream shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-ink/10 px-6 py-5">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-tightest">
                  Your Bag
                </h2>
                <p className="text-xs text-ink-muted">
                  {count} {count === 1 ? "item" : "items"}
                </p>
              </div>
              <button
                onClick={closeDrawer}
                className="grid h-9 w-9 place-items-center rounded-full border border-ink/15 transition-colors hover:bg-maroon-700 hover:text-cream"
                aria-label="Close bag"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-4 w-4"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-cream-dark">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="h-7 w-7 text-ink-muted"
                    >
                      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                      <path d="M3 6h18" />
                      <path d="M16 10a4 4 0 0 1-8 0" />
                    </svg>
                  </div>
                  <p className="text-sm text-ink-muted">Your bag is empty.</p>
                  <button onClick={() => go("/shop")} className="btn-ghost">
                    Browse the shop
                  </button>
                </div>
              ) : (
                <ul className="divide-y divide-ink/10">
                  {lines.map((line) => (
                    <li key={line.sku} className="flex gap-4 py-5">
                      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-cream-dark">
                        <ProductImage
                          product={{
                            sku: line.sku,
                            name: line.product?.name ?? line.sku,
                          }}
                          className="h-full w-full"
                        />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold leading-tight">
                              {line.product?.name ?? line.sku}
                            </p>
                            <p className="font-mono text-[11px] text-ink-muted">
                              {line.sku}
                            </p>
                          </div>
                          <button
                            onClick={() => remove(line.sku)}
                            className="text-[11px] uppercase tracking-wider text-ink-muted transition-colors hover:text-maroon-700"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <div className="flex items-center gap-1 rounded-full border border-ink/15 p-0.5">
                            <button
                              onClick={() => setQty(line.sku, line.qty - 1)}
                              className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream"
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span className="w-6 text-center text-sm font-semibold">
                              {line.qty}
                            </span>
                            <button
                              onClick={() => setQty(line.sku, line.qty + 1)}
                              className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream"
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </div>
                          <span className="text-sm font-semibold">
                            {money(line.lineTotalCents)}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {lines.length > 0 && (
              <div className="border-t border-ink/10 bg-cream-dark/50 px-6 py-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-ink-muted">Subtotal</span>
                  <span className="font-display text-xl font-semibold tracking-tightest">
                    {money(subtotalCents)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Taxes settled at checkout.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => go("/cart")}
                    className="btn-ghost flex-1"
                  >
                    View bag
                  </button>
                  <button
                    onClick={() => go("/checkout")}
                    className="btn-primary flex-1"
                  >
                    Checkout
                  </button>
                </div>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

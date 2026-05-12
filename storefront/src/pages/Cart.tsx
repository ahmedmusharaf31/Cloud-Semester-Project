import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import Page from "../components/Page";
import ProductImage from "../components/ProductImage";
import { useCart } from "../state/cart";
import { money } from "../lib/format";

export default function Cart() {
  const { lines, count, subtotalCents, setQty, remove, clear, loading } =
    useCart();
  const navigate = useNavigate();

  if (!loading && lines.length === 0) {
    return (
      <Page>
        <div className="container-x flex flex-col items-center py-48 text-center">
          <div className="grid h-20 w-20 place-items-center rounded-full bg-cream-dark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              className="h-9 w-9 text-ink-muted"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <h1 className="display-hero mt-6 text-4xl">Your bag is empty.</h1>
          <p className="mt-3 text-ink-soft">
            Nothing in here yet. The catalog is waiting.
          </p>
          <Link to="/shop" className="btn-primary mt-7">
            Start shopping
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="container-x pt-32 lg:pt-40">
        <div className="flex items-end justify-between gap-6 border-b border-ink/10 pb-8">
          <div>
            <span className="chip">Your bag</span>
            <h1 className="display-hero mt-4 text-5xl sm:text-6xl">
              {count} {count === 1 ? "item" : "items"}, ready.
            </h1>
          </div>
          {lines.length > 0 && (
            <button
              onClick={clear}
              className="hidden text-sm text-ink-muted link-underline sm:block"
            >
              Clear bag
            </button>
          )}
        </div>

        <div className="grid gap-12 py-12 lg:grid-cols-[1.6fr_1fr]">
          {/* Lines */}
          <ul className="divide-y divide-ink/10">
            {lines.map((line) => (
              <motion.li
                key={line.sku}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-5 py-6"
              >
                <Link
                  to={`/product/${line.sku}`}
                  className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-cream-dark"
                >
                  <ProductImage
                    product={{
                      sku: line.sku,
                      name: line.product?.name ?? line.sku,
                    }}
                    className="h-full w-full"
                  />
                </Link>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        to={`/product/${line.sku}`}
                        className="font-display text-lg font-semibold tracking-tightest hover:text-maroon-700"
                      >
                        {line.product?.name ?? line.sku}
                      </Link>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                        {line.sku}
                      </p>
                    </div>
                    <span className="font-display text-lg font-semibold tracking-tightest">
                      {money(line.lineTotalCents)}
                    </span>
                  </div>
                  <div className="mt-auto flex items-center justify-between pt-3">
                    <div className="flex items-center gap-1 rounded-full border border-ink/15 p-0.5">
                      <button
                        onClick={() => setQty(line.sku, line.qty - 1)}
                        className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream"
                        aria-label="Decrease quantity"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-sm font-semibold">
                        {line.qty}
                      </span>
                      <button
                        onClick={() => setQty(line.sku, line.qty + 1)}
                        className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream"
                        aria-label="Increase quantity"
                      >
                        +
                      </button>
                    </div>
                    <button
                      onClick={() => remove(line.sku)}
                      className="text-[11px] uppercase tracking-wider text-ink-muted transition-colors hover:text-maroon-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>

          {/* Summary */}
          <aside className="h-fit rounded-[2rem] bg-sand p-8 text-ink ring-1 ring-ink/5 lg:sticky lg:top-28">
            <h2 className="font-display text-2xl font-semibold tracking-tightest">
              Summary
            </h2>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between text-ink-soft">
                <dt>Items</dt>
                <dd>{count}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>Subtotal</dt>
                <dd>{money(subtotalCents)}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>Shipping</dt>
                <dd>Calculated at checkout</dd>
              </div>
              <div className="mt-4 flex justify-between border-t border-ink/10 pt-4 font-display text-xl font-semibold tracking-tightest">
                <dt>Total</dt>
                <dd>{money(subtotalCents)}</dd>
              </div>
            </dl>
            <button
              onClick={() => navigate("/checkout")}
              className="btn-primary mt-7 w-full"
            >
              Proceed to checkout
            </button>
            <Link
              to="/shop"
              className="mt-3 block text-center text-xs text-ink-muted link-underline"
            >
              Continue shopping
            </Link>
          </aside>
        </div>
      </div>
    </Page>
  );
}

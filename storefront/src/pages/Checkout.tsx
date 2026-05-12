import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Page from "../components/Page";
import ProductImage from "../components/ProductImage";
import { useCart } from "../state/cart";
import { money } from "../lib/format";
import type { OrderResult } from "../lib/api";

type Phase =
  | { status: "review" }
  | { status: "placing" }
  | { status: "done"; result: OrderResult; ms: number };

export default function Checkout() {
  const { lines, count, subtotalCents, checkout, loading } = useCart();
  const [phase, setPhase] = useState<Phase>({ status: "review" });

  const place = async () => {
    setPhase({ status: "placing" });
    const t0 = performance.now();
    const result = await checkout();
    if (!result) {
      setPhase({ status: "review" });
      return;
    }
    setPhase({
      status: "done",
      result,
      ms: Math.round(performance.now() - t0),
    });
  };

  // ----- confirmation -----
  if (phase.status === "done") {
    return (
      <Page>
        <div className="container-x flex flex-col items-center py-44 text-center">
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 18 }}
            className="grid h-20 w-20 place-items-center rounded-full bg-emerald-500 text-cream"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className="h-9 w-9"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </motion.div>
          <h1 className="display-hero mt-7 text-5xl">Order placed.</h1>
          <p className="mt-4 max-w-md text-ink-soft">
            Order{" "}
            <span className="font-semibold text-maroon-700">
              #{phase.result.orderId}
            </span>{" "}
            was accepted and queued for fulfilment via SQS, in just{" "}
            <span className="font-semibold">{phase.ms} ms</span>.
          </p>

          <dl className="mt-9 flex gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 text-sm">
            {[
              ["Order", `#${phase.result.orderId}`],
              ["Total", money(phase.result.total_cents)],
              ["Status", phase.result.status],
            ].map(([k, v]) => (
              <div key={k} className="bg-cream px-6 py-4">
                <dt className="text-[11px] uppercase tracking-wider text-ink-muted">
                  {k}
                </dt>
                <dd className="mt-0.5 font-display text-lg font-semibold tracking-tightest">
                  {v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-9 flex gap-3">
            <Link to="/shop" className="btn-primary">
              Continue shopping
            </Link>
            <Link to="/" className="btn-ghost">
              Back home
            </Link>
          </div>
        </div>
      </Page>
    );
  }

  // ----- empty bag -----
  if (!loading && lines.length === 0) {
    return (
      <Page>
        <div className="container-x flex flex-col items-center py-48 text-center">
          <h1 className="display-hero text-4xl">Nothing to check out.</h1>
          <p className="mt-3 text-ink-soft">Your bag is empty.</p>
          <Link to="/shop" className="btn-primary mt-7">
            Browse the catalog
          </Link>
        </div>
      </Page>
    );
  }

  const placing = phase.status === "placing";

  // ----- review -----
  return (
    <Page>
      <div className="container-x pt-32 lg:pt-40">
        <span className="chip">Checkout</span>
        <h1 className="display-hero mt-4 text-5xl sm:text-6xl">
          One tap from done.
        </h1>

        <div className="grid gap-12 py-12 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tightest">
              Order review
            </h2>
            <ul className="mt-5 divide-y divide-ink/10">
              {lines.map((line) => (
                <li key={line.sku} className="flex items-center gap-4 py-4">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-cream-dark">
                    <ProductImage
                      product={{
                        sku: line.sku,
                        name: line.product?.name ?? line.sku,
                      }}
                      className="h-full w-full"
                    />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">
                      {line.product?.name ?? line.sku}
                    </p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
                      {line.sku} · qty {line.qty}
                    </p>
                  </div>
                  <span className="font-display font-semibold tracking-tightest">
                    {money(line.lineTotalCents)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-2xl bg-cream-dark/60 p-5 text-sm text-ink-soft">
              <p className="font-medium text-ink">How this works</p>
              <p className="mt-1 leading-relaxed">
                Placing the order hits the Orders service, which prices every
                line against the Catalog database, writes the order to RDS, and
                drops a fulfilment message on SQS. Your bag is cleared on
                success.
              </p>
            </div>
          </div>

          {/* Summary / action */}
          <aside className="h-fit rounded-[2rem] bg-sand p-8 text-ink ring-1 ring-ink/5 lg:sticky lg:top-28">
            <h2 className="font-display text-2xl font-semibold tracking-tightest">
              Payable now
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
              <div className="mt-4 flex justify-between border-t border-ink/10 pt-4 font-display text-2xl font-semibold tracking-tightest">
                <dt>Total</dt>
                <dd>{money(subtotalCents)}</dd>
              </div>
            </dl>
            <button
              onClick={place}
              disabled={placing}
              className="btn-primary mt-7 w-full"
            >
              {placing ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-cream/40 border-t-cream" />
                  Placing order…
                </>
              ) : (
                "Place order"
              )}
            </button>
            <Link
              to="/cart"
              className="mt-3 block text-center text-xs text-ink-muted link-underline"
            >
              Back to bag
            </Link>
          </aside>
        </div>
      </div>
    </Page>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import Page from "../components/Page";
import ProductImage from "../components/ProductImage";
import ProductCard from "../components/ProductCard";
import { getProduct, getProducts, type Product as P } from "../lib/api";
import { money, stockLabel, stockLevel } from "../lib/format";
import { categoryFor } from "../lib/products";
import { useCart } from "../state/cart";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; product: P; related: P[] }
  | { status: "missing" }
  | { status: "error"; message: string };

export default function Product() {
  const { sku = "" } = useParams();
  const navigate = useNavigate();
  const { add, openDrawer } = useCart();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    setQty(1);
    Promise.all([getProduct(sku), getProducts().catch(() => null)])
      .then(([product, all]) => {
        if (!alive) return;
        const related =
          all?.products
            .filter((p) => p.sku !== product.sku)
            .slice(0, 4) ?? [];
        setState({ status: "ready", product, related });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : "Failed to load product";
        setState(
          msg.includes("404")
            ? { status: "missing" }
            : { status: "error", message: msg },
        );
      });
    return () => {
      alive = false;
    };
  }, [sku]);

  if (state.status === "loading") {
    return (
      <Page>
        <div className="container-x grid gap-12 pt-32 lg:grid-cols-2 lg:pt-40">
          <div className="skeleton aspect-square rounded-[2rem]" />
          <div className="space-y-4 py-6">
            <div className="skeleton h-4 w-1/4 rounded" />
            <div className="skeleton h-12 w-3/4 rounded" />
            <div className="skeleton h-6 w-1/3 rounded" />
            <div className="skeleton h-24 w-full rounded-xl" />
            <div className="skeleton h-12 w-full rounded-full" />
          </div>
        </div>
      </Page>
    );
  }

  if (state.status === "missing") {
    return (
      <Page>
        <div className="container-x flex flex-col items-center py-48 text-center">
          <p className="font-mono text-sm text-ink-muted">{sku}</p>
          <h1 className="display-hero mt-3 text-4xl">This SKU isn't stocked.</h1>
          <Link to="/shop" className="btn-primary mt-7">
            Back to the shop
          </Link>
        </div>
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page>
        <div className="container-x flex flex-col items-center py-48 text-center">
          <h1 className="display-hero text-3xl text-maroon-800">
            Couldn't load this product.
          </h1>
          <p className="mt-2 text-sm text-ink-muted">{state.message}</p>
          <Link to="/shop" className="btn-ghost mt-7">
            Back to the shop
          </Link>
        </div>
      </Page>
    );
  }

  const { product, related } = state;
  const level = stockLevel(product.inventory);
  const soldOut = level === "out";
  const maxQty = Math.max(1, Math.min(product.inventory, 99));

  const handleAdd = async () => {
    await add(product.sku, qty);
    openDrawer();
  };

  return (
    <Page>
      <div className="container-x pt-28 lg:pt-36">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-ink-muted link-underline"
        >
          ← Back
        </button>

        <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative aspect-square overflow-hidden rounded-[2rem] bg-cream-dark shadow-xl"
          >
            <ProductImage product={product} big className="h-full w-full" />
            <span className="absolute left-4 top-4 rounded-full bg-cream/85 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-soft backdrop-blur">
              {categoryFor(product)}
            </span>
          </motion.div>

          <div className="flex flex-col py-2">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-muted">
              {product.sku}
            </p>
            <h1 className="display-hero mt-2 text-4xl sm:text-5xl">
              {product.name}
            </h1>
            <div className="mt-4 flex items-center gap-4">
              <span className="font-display text-3xl font-semibold tracking-tightest">
                {money(product.price_cents)}
              </span>
              <span
                className={[
                  "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                  level === "in"
                    ? "bg-emerald-50 text-emerald-700"
                    : level === "low"
                      ? "bg-amber-50 text-amber-700"
                      : "bg-maroon-50 text-maroon-700",
                ].join(" ")}
              >
                {stockLabel(product.inventory)}
              </span>
            </div>

            <p className="mt-6 max-w-md leading-relaxed text-ink-soft">
              A {categoryFor(product).toLowerCase()} from the GIKI Mart catalog,
              served by the Catalog microservice and priced in real time. Add it
              to your bag, and the Cart service keeps your session in DynamoDB, so
              it survives a tab refresh.
            </p>

            <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink/10 bg-ink/10 text-sm">
              {[
                ["Catalog ID", `#${product.id}`],
                ["SKU", product.sku],
                ["On hand", `${product.inventory} units`],
                ["Category", categoryFor(product)],
              ].map(([k, v]) => (
                <div key={k} className="bg-cream px-4 py-3">
                  <dt className="text-[11px] uppercase tracking-wider text-ink-muted">
                    {k}
                  </dt>
                  <dd className="mt-0.5 font-medium">{v}</dd>
                </div>
              ))}
            </dl>

            {/* Qty + add */}
            <div className="mt-8 flex items-center gap-3">
              <div className="flex items-center gap-1 rounded-full border border-ink/15 p-1">
                <button
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={soldOut}
                  className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream disabled:opacity-30"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-8 text-center font-semibold">{qty}</span>
                <button
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  disabled={soldOut}
                  className="grid h-9 w-9 place-items-center rounded-full text-ink-soft transition-colors hover:bg-maroon-700 hover:text-cream disabled:opacity-30"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAdd}
                disabled={soldOut}
                className="btn-primary flex-1"
              >
                {soldOut ? "Sold out" : `Add ${qty} to bag`}
              </button>
            </div>
          </div>
        </div>

        {related.length > 0 && (
          <section className="mt-28">
            <h2 className="display-hero text-3xl sm:text-4xl">
              You might also like
            </h2>
            <div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
              {related.map((p, i) => (
                <ProductCard key={p.sku} product={p} index={i} />
              ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}

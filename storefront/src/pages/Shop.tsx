import { useEffect, useMemo, useState } from "react";
import Page from "../components/Page";
import ProductCard from "../components/ProductCard";
import ProductGridSkeleton from "../components/ProductGridSkeleton";
import { getProducts, type Product } from "../lib/api";
import { stockLevel } from "../lib/format";

type Sort = "featured" | "price-asc" | "price-desc" | "name";
type Filter = "all" | "available" | "low";

const SORTS: { id: Sort; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
  { id: "name", label: "A–Z" },
];

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "available", label: "In stock" },
  { id: "low", label: "Selling fast" },
];

type LoadState =
  | { status: "loading" }
  | { status: "ready"; products: Product[]; latencyMs: number }
  | { status: "error"; message: string };

export default function Shop() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [sort, setSort] = useState<Sort>("featured");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    getProducts()
      .then(({ products, latencyMs }) => {
        if (alive) setState({ status: "ready", products, latencyMs });
      })
      .catch((e: unknown) => {
        if (alive)
          setState({
            status: "error",
            message: e instanceof Error ? e.message : "Failed to load catalog",
          });
      });
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (state.status !== "ready") return [];
    let list = [...state.products];
    if (filter === "available")
      list = list.filter((p) => stockLevel(p.inventory) !== "out");
    if (filter === "low")
      list = list.filter((p) => stockLevel(p.inventory) === "low");
    switch (sort) {
      case "price-asc":
        list.sort((a, b) => a.price_cents - b.price_cents);
        break;
      case "price-desc":
        list.sort((a, b) => b.price_cents - a.price_cents);
        break;
      case "name":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return list;
  }, [state, sort, filter]);

  return (
    <Page>
      <section className="container-x pt-32 lg:pt-40">
        <div className="flex flex-col gap-6 border-b border-ink/10 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <span className="chip">The catalog</span>
            <h1 className="display-hero mt-4 text-5xl sm:text-6xl">
              Every product, live.
            </h1>
            <p className="mt-4 max-w-md text-ink-soft">
              Pulled straight from the Catalog service on each visit. Change a
              row in the database and it shows up here.
            </p>
          </div>
          {state.status === "ready" && (
            <div className="shrink-0 rounded-2xl bg-sand px-5 py-4 font-mono text-xs text-ink ring-1 ring-ink/10">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-sage" />
                catalog service · healthy
              </div>
              <div className="mt-1 text-ink-muted">
                {state.products.length} SKUs · {state.latencyMs} ms response
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-8">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={[
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  filter === f.id
                    ? "bg-maroon-700 text-cream"
                    : "bg-white/60 text-ink-soft ring-1 ring-ink/10 hover:ring-ink/30",
                ].join(" ")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={[
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  sort === s.id
                    ? "bg-maroon-700 text-cream"
                    : "bg-white/60 text-ink-soft ring-1 ring-ink/10 hover:ring-ink/30",
                ].join(" ")}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="container-x pb-24">
        {state.status === "loading" && <ProductGridSkeleton count={8} />}

        {state.status === "error" && (
          <div className="rounded-2xl border border-maroon-200 bg-maroon-50 p-10 text-center">
            <p className="font-display text-xl font-semibold text-maroon-800">
              The catalog service is unreachable.
            </p>
            <p className="mt-2 text-sm text-maroon-700/70">{state.message}</p>
          </div>
        )}

        {state.status === "ready" && visible.length === 0 && (
          <div className="rounded-2xl border border-ink/10 bg-white/60 p-14 text-center">
            <p className="font-display text-xl font-semibold">
              Nothing matches that filter.
            </p>
            <button
              onClick={() => setFilter("all")}
              className="btn-ghost mt-5"
            >
              Reset filters
            </button>
          </div>
        )}

        {state.status === "ready" && visible.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-12 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((p, i) => (
              <ProductCard key={p.sku} product={p} index={i} />
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

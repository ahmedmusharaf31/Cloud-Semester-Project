import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useMotionValue,
} from "framer-motion";
import Page from "../components/Page";
import Reveal from "../components/Reveal";
import RevealText from "../components/RevealText";
import Marquee from "../components/Marquee";
import Counter from "../components/Counter";
import Magnetic from "../components/Magnetic";
import ProductCard from "../components/ProductCard";
import ProductGridSkeleton from "../components/ProductGridSkeleton";
import ProductImage from "../components/ProductImage";
import { getProducts, type Product } from "../lib/api";
import { money } from "../lib/format";

const MARQUEE = [
  "Auto-scaling",
  "Zero 5xx",
  "Chaos-tested",
  "Fargate",
  "Load-balanced",
  "Resilient by design",
];

const ARROW = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="h-4 w-4"
  >
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);

type LoadState =
  | { status: "loading" }
  | { status: "ready"; products: Product[]; latencyMs: number }
  | { status: "error"; message: string };

export default function Home() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [heroIndex, setHeroIndex] = useState(0);

  // Scroll-driven parallax for the hero layer.
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"],
  });
  const heroImgY = useTransform(scrollYProgress, [0, 1], [0, 120]);

  // Pointer parallax for the hero showcase + ambient blobs.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 120, damping: 20 });
  const sy = useSpring(py, { stiffness: 120, damping: 20 });
  const blobX = useTransform(sx, (v) => v * 40);
  const blobY = useTransform(sy, (v) => v * 40);
  const blobXNeg = useTransform(sx, (v) => v * -40);
  const tiltX = useTransform(sy, (v) => v * -10);
  const tiltY = useTransform(sx, (v) => v * 10);
  const cardX = useTransform(sx, (v) => v * -26);
  const cardY = useTransform(sy, (v) => v * -26);
  const cardYNeg = useTransform(sy, (v) => v * 26);

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

  const onHeroMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    px.set((e.clientX - (r.left + r.width / 2)) / r.width);
    py.set((e.clientY - (r.top + r.height / 2)) / r.height);
  };
  const resetHero = () => {
    px.set(0);
    py.set(0);
  };

  const featured =
    state.status === "ready" ? state.products.slice(0, 4) : [];
  const heroPool =
    state.status === "ready" ? state.products.slice(0, 5) : [];
  const heroProduct = heroPool[heroIndex % Math.max(heroPool.length, 1)];
  const skuCount = state.status === "ready" ? state.products.length : null;

  const stepHero = (dir: number) =>
    setHeroIndex((i) => (i + dir + heroPool.length) % heroPool.length);

  return (
    <Page>
      {/* ---------- HERO ---------- */}
      <section
        ref={heroRef}
        onMouseMove={onHeroMove}
        onMouseLeave={resetHero}
        className="relative overflow-hidden pt-32 pb-20 lg:pt-44 lg:pb-28"
      >
        <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-60" />
        <motion.div
          aria-hidden
          style={{ x: blobX, y: blobY }}
          className="pointer-events-none absolute -right-40 -top-24 h-[36rem] w-[36rem] rounded-full bg-maroon-200/40 blur-3xl"
        />
        <motion.div
          aria-hidden
          style={{ x: blobXNeg, y: blobY }}
          className="pointer-events-none absolute -left-32 top-40 h-96 w-96 rounded-full bg-amber-100/50 blur-3xl"
        />

        <div className="container-x relative grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="chip"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live on AWS Fargate
            </motion.span>

            <h1 className="display-hero mt-6 text-[3.4rem] sm:text-7xl lg:text-[5.6rem]">
              <RevealText
                lines={[
                  "Commerce",
                  { text: "that refuses", accent: true },
                  "to go down.",
                ]}
              />
            </h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.7 }}
              className="mt-7 max-w-md text-base leading-relaxed text-ink-soft"
            >
              GIKI Mart is a storefront engineered for failure. It scales itself
              under a flash-sale spike and shrugs off chaos experiments, and
              every order still lands.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.85 }}
              className="mt-9 flex flex-wrap items-center gap-3"
            >
              <Magnetic>
                <Link to="/shop" className="btn-primary">
                  Shop the catalog
                  {ARROW}
                </Link>
              </Magnetic>
              <Magnetic strength={0.25}>
                <Link to="/about" className="btn-ghost">
                  See the architecture
                </Link>
              </Magnetic>
            </motion.div>

            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 1 }}
              className="mt-12 flex flex-wrap gap-10"
            >
              <Stat
                k="Catalog latency"
                node={
                  state.status === "ready" ? (
                    <Counter value={state.latencyMs} suffix=" ms" />
                  ) : state.status === "error" ? (
                    "n/a"
                  ) : (
                    "···"
                  )
                }
              />
              <Stat k="5xx under chaos" node={<Counter value={0} suffix="%" />} />
              <Stat
                k="Recovery time"
                node={<Counter value={2} prefix="~" suffix=" min" />}
              />
            </motion.dl>
          </div>

          {/* Hero product showcase */}
          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: 3 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{ y: heroImgY, perspective: 1000 }}
            className="relative"
          >
            <motion.div
              style={{ rotateX: tiltX, rotateY: tiltY }}
              className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-cream-dark shadow-2xl ring-1 ring-ink/5"
            >
              {heroProduct ? (
                <motion.div
                  key={heroProduct.sku}
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full w-full"
                >
                  <ProductImage
                    product={heroProduct}
                    big
                    className="h-full w-full"
                  />
                </motion.div>
              ) : (
                <div className="skeleton h-full w-full" />
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/30 to-transparent"
              />
            </motion.div>

            {heroProduct && (
              <motion.div
                style={{ x: cardX, y: cardY }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1 }}
                className="absolute -bottom-6 -left-6 w-56 rounded-2xl bg-cream/95 p-4 shadow-xl ring-1 ring-ink/5 backdrop-blur"
              >
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                  {heroProduct.sku}
                </p>
                <p className="mt-1 font-display text-base font-semibold tracking-tightest">
                  {heroProduct.name}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-display text-lg font-semibold">
                    {money(heroProduct.price_cents)}
                  </span>
                  <Link
                    to={`/product/${heroProduct.sku}`}
                    className="text-xs font-medium text-maroon-700 link-underline"
                  >
                    View
                  </Link>
                </div>
              </motion.div>
            )}

            {/* Prev / next product controls */}
            {heroPool.length > 1 && (
              <motion.div
                style={{ x: cardX, y: cardYNeg }}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 1.25 }}
                className="absolute -bottom-6 -right-6 flex items-center gap-1 rounded-full bg-sand p-1.5 shadow-xl ring-1 ring-ink/10"
              >
                <button
                  onClick={() => stepHero(-1)}
                  aria-label="Previous product"
                  className="grid h-9 w-9 place-items-center rounded-full bg-cream text-ink transition-colors hover:bg-maroon-700 hover:text-cream"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M15 6l-6 6 6 6" />
                  </svg>
                </button>
                <span className="px-1 font-mono text-[11px] tabular-nums text-ink-soft">
                  {(heroIndex % heroPool.length) + 1}/{heroPool.length}
                </span>
                <button
                  onClick={() => stepHero(1)}
                  aria-label="Next product"
                  className="grid h-9 w-9 place-items-center rounded-full bg-cream text-ink transition-colors hover:bg-maroon-700 hover:text-cream"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </motion.div>
            )}

            <motion.div
              style={{ x: cardX, y: cardYNeg }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, delay: 1.15 }}
              className="absolute -right-4 -top-4 flex items-center gap-2 rounded-full bg-sand px-4 py-2 font-mono text-[11px] text-ink shadow-xl ring-1 ring-ink/10"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-sage" />
              {skuCount ? `${skuCount} SKUs live` : "catalog live"}
            </motion.div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4 }}
          className="container-x relative mt-16 hidden items-center gap-3 text-[11px] uppercase tracking-[0.25em] text-ink-muted lg:flex"
        >
          <span>Scroll</span>
          <motion.span
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            className="block h-8 w-px bg-ink-muted/50"
          />
        </motion.div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <section className="border-y border-ink/10 bg-sand py-4 text-ink-soft">
        <Marquee items={MARQUEE} />
      </section>

      {/* ---------- FEATURED ---------- */}
      <section className="container-x py-24">
        <Reveal className="flex items-end justify-between gap-6">
          <div>
            <span className="chip">Today's picks</span>
            <h2 className="display-hero mt-4 text-4xl sm:text-5xl">
              Fresh off the catalog
            </h2>
          </div>
          <Link
            to="/shop"
            className="hidden shrink-0 text-sm font-medium text-ink-soft link-underline sm:block"
          >
            View all products →
          </Link>
        </Reveal>

        <div className="mt-12">
          {state.status === "loading" && <ProductGridSkeleton count={4} />}
          {state.status === "error" && (
            <div className="rounded-2xl border border-maroon-200 bg-maroon-50 p-8 text-center">
              <p className="font-medium text-maroon-800">
                Couldn't reach the catalog service.
              </p>
              <p className="mt-1 text-sm text-maroon-700/70">{state.message}</p>
            </div>
          )}
          {state.status === "ready" && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-4">
              {featured.map((p, i) => (
                <ProductCard key={p.sku} product={p} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---------- TECH STRIP ---------- */}
      <section className="container-x pb-8">
        <Reveal className="relative overflow-hidden rounded-[2rem] bg-sand px-8 py-14 text-ink ring-1 ring-ink/5 sm:px-14">
          <div
            aria-hidden
            className="absolute inset-0 bg-dotgrid opacity-40"
          />
          <div className="relative grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <h2 className="display-hero text-4xl sm:text-5xl">
                Built to survive the worst day.
              </h2>
              <p className="mt-5 max-w-xl text-ink-soft">
                Three microservices, Catalog, Cart and Orders, on ECS Fargate
                behind an Application Load Balancer. Auto-scaling on CPU, fault
                isolation between services, and two chaos experiments proving
                zero user-visible errors.
              </p>
              <Magnetic className="mt-7">
                <Link to="/about" className="btn-primary">
                  Explore the architecture
                  {ARROW}
                </Link>
              </Magnetic>
            </div>
            <div className="flex gap-3 font-mono text-xs">
              <div className="space-y-3">
                {["Fargate", "ALB", "RDS"].map((t, i) => (
                  <motion.div
                    key={t}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="rounded-xl border border-ink/15 bg-cream/50 px-4 py-3 text-center transition-colors hover:border-maroon-700/40 hover:bg-cream"
                  >
                    {t}
                  </motion.div>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                {["DynamoDB", "SQS", "CloudWatch"].map((t, i) => (
                  <motion.div
                    key={t}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.15 + i * 0.1 }}
                    className="rounded-xl border border-ink/15 bg-cream/50 px-4 py-3 text-center transition-colors hover:border-maroon-700/40 hover:bg-cream"
                  >
                    {t}
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </Page>
  );
}

function Stat({ k, node }: { k: string; node: React.ReactNode }) {
  return (
    <div>
      <dd className="font-display text-2xl font-semibold tracking-tightest text-ink">
        {node}
      </dd>
      <dt className="mt-1 text-[11px] uppercase tracking-wider text-ink-muted">
        {k}
      </dt>
    </div>
  );
}

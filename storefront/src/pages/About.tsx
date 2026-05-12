import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import Page from "../components/Page";
import Reveal from "../components/Reveal";
import RevealText from "../components/RevealText";
import Magnetic from "../components/Magnetic";
import Counter from "../components/Counter";
import ArchitectureMap from "../components/ArchitectureMap";

const SERVICES = [
  {
    name: "Catalog",
    compute: "Fargate · 0.25 vCPU",
    store: "RDS PostgreSQL",
    role: "Serves the product list and per-SKU lookups.",
  },
  {
    name: "Cart",
    compute: "Fargate · 0.25 vCPU",
    store: "DynamoDB",
    role: "Holds each session's bag as a nested item map.",
  },
  {
    name: "Orders",
    compute: "Fargate · 0.25 vCPU",
    store: "RDS PostgreSQL + SQS",
    role: "Prices, persists and queues every order for fulfilment.",
  },
];

const CHAOS = [
  {
    title: "Task termination",
    target: "Catalog",
    hypothesis: "ALB drains the dead target; ECS restores it within ~90s.",
    result: "0 to 1 task in ~2 min, 0 5xx throughout.",
  },
  {
    title: "Latency injection",
    target: "Orders · +500ms",
    hypothesis: "Orders p95 climbs ~11x; Cart and Catalog stay untouched.",
    result: "≈ 550ms avg, fault isolated, auto-rolled back.",
  },
];

const NUMBERS = [
  { value: 14, suffix: " ms", k: "Baseline p95 latency" },
  { value: 0, suffix: "%", k: "Error rate at 200 VUs" },
  { value: 2, prefix: "~", suffix: " min", k: "Task-kill recovery" },
  { value: 9, prefix: "6 to ", suffix: " min", k: "Auto-scale, end to end" },
];

export default function About() {
  const chaosRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: chaosRef,
    offset: ["start end", "end start"],
  });
  const glowY = useTransform(scrollYProgress, [0, 1], [-60, 60]);

  return (
    <Page>
      {/* Hero */}
      <section className="relative overflow-hidden pt-36 lg:pt-44">
        <div aria-hidden className="absolute inset-0 bg-dotgrid opacity-50" />
        <div className="container-x relative">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="chip"
          >
            The architecture
          </motion.span>
          <h1 className="display-hero mt-5 max-w-4xl text-5xl sm:text-7xl">
            <RevealText
              lines={[
                "A storefront that treats",
                { text: "failure as a feature.", accent: true },
              ]}
            />
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-7 max-w-xl text-lg leading-relaxed text-ink-soft"
          >
            GIKI Mart is the front end of a CE-408 Cloud Computing project: an
            auto-scaling, chaos-tested e-commerce backend on AWS. The UI you are
            using talks to three independent microservices through a single
            Application Load Balancer.
          </motion.p>
        </div>
      </section>

      {/* Flow */}
      <section className="container-x py-20">
        <Reveal className="mb-8 flex items-end justify-between gap-6">
          <h2 className="display-hero text-3xl sm:text-4xl">
            One request, five hops.
          </h2>
          <span className="hidden font-mono text-xs text-ink-muted sm:block">
            live traffic shown in motion
          </span>
        </Reveal>
        <Reveal>
          <ArchitectureMap />
        </Reveal>
      </section>

      {/* Services */}
      <section className="container-x py-8">
        <Reveal>
          <h2 className="display-hero text-4xl sm:text-5xl">Three services.</h2>
          <p className="mt-3 max-w-md text-ink-soft">
            Each one owns its data store and scales on its own CPU, so a slow
            Orders service never drags Catalog down.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {SERVICES.map((s, i) => (
            <Reveal key={s.name} delay={i * 0.08}>
              <motion.div
                whileHover={{ y: -6 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="flex h-full flex-col rounded-2xl border border-ink/10 bg-cream p-6"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-2xl font-semibold tracking-tightest">
                    {s.name}
                  </h3>
                  <span className="font-mono text-[11px] text-ink-muted">
                    0{i + 1}
                  </span>
                </div>
                <p className="mt-3 text-sm text-ink-soft">{s.role}</p>
                <dl className="mt-6 space-y-2 border-t border-ink/10 pt-4 font-mono text-xs text-ink-muted">
                  <div className="flex justify-between gap-3">
                    <dt>compute</dt>
                    <dd className="text-right text-ink-soft">{s.compute}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>store</dt>
                    <dd className="text-right text-ink-soft">{s.store}</dd>
                  </div>
                </dl>
              </motion.div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Chaos */}
      <section className="container-x py-20">
        <Reveal>
          <div
            ref={chaosRef}
            className="relative overflow-hidden rounded-[2rem] bg-sand p-8 text-ink ring-1 ring-ink/5 sm:p-14"
          >
            <div
              aria-hidden
              className="absolute inset-0 bg-dotgrid opacity-40"
            />
            <motion.div
              aria-hidden
              style={{ y: glowY }}
              className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-maroon-200/45 blur-3xl"
            />
            <motion.div
              aria-hidden
              style={{ y: glowY }}
              className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-sage/25 blur-3xl"
            />

            <div className="relative">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-ink-soft">
                <span className="h-1.5 w-1.5 rounded-full bg-sage" />
                Resilience, measured
              </span>
              <h2 className="display-hero mt-5 text-4xl sm:text-5xl">
                Two chaos experiments.
              </h2>
              <p className="mt-3 max-w-lg text-ink-soft">
                Resilience is not claimed, it is measured. Both experiments ran
                under live load with zero user-visible errors.
              </p>

              <div className="mt-10 grid gap-5 md:grid-cols-2">
                {CHAOS.map((c, i) => (
                  <motion.div
                    key={c.title}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-40px" }}
                    transition={{ duration: 0.6, delay: i * 0.12 }}
                    whileHover={{ y: -4 }}
                    className="rounded-2xl border border-ink/10 bg-cream p-6 transition-colors hover:border-maroon-700/40 hover:bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-xl font-semibold tracking-tightest">
                        {c.title}
                      </h3>
                      <span className="rounded-full bg-maroon-700/10 px-2.5 py-1 font-mono text-[11px] text-maroon-700">
                        {c.target}
                      </span>
                    </div>
                    <p className="mt-4 text-sm text-ink-soft">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                        Hypothesis
                      </span>
                      <br />
                      {c.hypothesis}
                    </p>
                    <p className="mt-3 text-sm text-ink">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-maroon-700">
                        Result
                      </span>
                      <br />
                      {c.result}
                    </p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Numbers */}
      <section className="container-x">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2rem] border border-ink/10 bg-ink/10 lg:grid-cols-4">
          {NUMBERS.map((n, i) => (
            <motion.div
              key={n.k}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="group bg-cream px-6 py-10 text-center transition-colors hover:bg-cream-dark"
            >
              <p className="font-display text-4xl font-semibold tracking-tightest text-maroon-700">
                <Counter
                  value={n.value}
                  prefix={n.prefix ?? ""}
                  suffix={n.suffix}
                />
              </p>
              <p className="mt-2 text-xs uppercase tracking-wider text-ink-muted">
                {n.k}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container-x py-24 text-center">
        <Reveal>
          <h2 className="display-hero text-4xl sm:text-5xl">Now go break it.</h2>
          <p className="mx-auto mt-4 max-w-md text-ink-soft">
            Browse the catalog, fill a bag, place an order. It all runs on the
            live AWS stack.
          </p>
          <Magnetic className="mt-7">
            <Link to="/shop" className="btn-primary">
              Open the shop
            </Link>
          </Magnetic>
        </Reveal>
      </section>
    </Page>
  );
}

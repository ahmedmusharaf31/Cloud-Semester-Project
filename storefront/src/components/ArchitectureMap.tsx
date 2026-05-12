import { Fragment } from "react";
import { motion } from "framer-motion";

// Animated request-flow diagram for the About page. Each stage is an
// equal-height card with a fixed-height header, so every icon and title lines
// up across the row. Connectors draw in on scroll and show a synced direction
// chevron. Row on desktop, column on mobile.

type IconKey = "browser" | "bucket" | "alb" | "fargate" | "data";

const Icon = ({ name }: { name: IconKey }) => {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "h-5 w-5",
  };
  switch (name) {
    case "browser":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
        </svg>
      );
    case "bucket":
      return (
        <svg {...common}>
          <path d="M5 7h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8Z" />
          <path d="M4 7h16M9 4h6" />
        </svg>
      );
    case "alb":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="2.4" />
          <circle cx="5" cy="19" r="2.4" />
          <circle cx="19" cy="19" r="2.4" />
          <path d="M12 7.4v4M12 11.4 5.8 16.8M12 11.4l6.2 5.4" />
        </svg>
      );
    case "fargate":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="8" y="13" width="8" height="8" rx="1.5" />
        </svg>
      );
    case "data":
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5.5" rx="7" ry="2.8" />
          <path d="M5 5.5v13c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-13" />
          <path d="M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
        </svg>
      );
  }
};

type Stage = {
  icon: IconKey;
  title: string;
  meta: string;
  sub?: { name: string; tag: string }[];
};

const STAGES: Stage[] = [
  { icon: "browser", title: "Browser", meta: "Customer device" },
  { icon: "bucket", title: "S3 Storefront", meta: "Static React bundle" },
  { icon: "alb", title: "ALB", meta: "Path-based routing" },
  {
    icon: "fargate",
    title: "Fargate x3",
    meta: "Auto-scaling on CPU",
    sub: [
      { name: "Catalog", tag: "/catalog/*" },
      { name: "Cart", tag: "/cart/*" },
      { name: "Orders", tag: "/orders/*" },
    ],
  },
  {
    icon: "data",
    title: "Data layer",
    meta: "Per-service stores",
    sub: [
      { name: "RDS Postgres", tag: "catalog, orders" },
      { name: "DynamoDB", tag: "cart sessions" },
      { name: "SQS", tag: "fulfilment" },
    ],
  },
];

function Connector({ index }: { index: number }) {
  return (
    <div className="flex shrink-0 items-center justify-center py-2 lg:w-14 lg:py-0">
      {/* Mobile: vertical flowing beam. */}
      <motion.div
        initial={{ scaleY: 0 }}
        whileInView={{ scaleY: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45, delay: index * 0.12 }}
        className="h-9 w-[3px] origin-top rounded-full bg-gradient-to-b from-sage/10 via-sage to-sage/10 bg-[length:100%_300%] animate-flow-y lg:hidden"
      />
      {/* Desktop: horizontal flowing beam. Pure CSS animation, so every
          connector stays perfectly in sync. */}
      <motion.div
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.45, delay: index * 0.12 }}
        className="hidden h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-sage/10 via-sage to-sage/10 bg-[length:300%_100%] animate-flow-x lg:block"
      />
    </div>
  );
}

function StageCard({ stage, index }: { stage: Stage; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        duration: 0.6,
        delay: index * 0.16,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="group flex flex-1 flex-col rounded-2xl border border-ink/10 bg-cream-dark p-5 shadow-sm ring-1 ring-ink/5 transition-colors hover:border-maroon-700/40"
    >
      {/* Fixed-height header keeps every icon + title aligned across cards. */}
      <div className="flex h-14 items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-maroon-700 text-cream transition-transform duration-300 group-hover:-rotate-6">
          <Icon name={stage.icon} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold leading-tight tracking-tightest">
            {stage.title}
          </p>
          <p className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {stage.meta}
          </p>
        </div>
      </div>

      {/* Sub-items area. Always present so the divider lines up; empty stages
          just reserve the space, keeping the row visually even. */}
      <div className="mt-4 flex-1 border-t border-ink/10 pt-4">
        {stage.sub ? (
          <div className="space-y-2">
            {stage.sub.map((s, i) => (
              <motion.div
                key={s.name}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.16 + 0.3 + i * 0.1 }}
                className="rounded-lg bg-cream px-3 py-2"
              >
                <span className="block truncate text-xs font-medium text-ink">
                  {s.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-maroon-700">
                  {s.tag}
                </span>
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted/60">
            single hop
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default function ArchitectureMap() {
  // No wrapping panel: the cards stand on their own, so nothing can be clipped
  // by a fixed-height container. Equal height comes from flex `items-stretch`.
  return (
    <div className="flex flex-col items-stretch lg:flex-row lg:items-stretch">
      {STAGES.map((stage, i) => (
        <Fragment key={stage.title}>
          <StageCard stage={stage} index={i} />
          {i < STAGES.length - 1 && <Connector index={i} />}
        </Fragment>
      ))}
    </div>
  );
}

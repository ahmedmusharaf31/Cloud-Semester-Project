import { Link } from "react-router-dom";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import type { Product } from "../lib/api";
import { money, stockLabel, stockLevel } from "../lib/format";
import { categoryFor } from "../lib/products";
import { useCart } from "../state/cart";
import ProductImage from "./ProductImage";

const STOCK_STYLES: Record<string, string> = {
  in: "text-emerald-700 bg-emerald-50",
  low: "text-amber-700 bg-amber-50",
  out: "text-maroon-700 bg-maroon-50",
};

export default function ProductCard({
  product,
  index = 0,
}: {
  product: Product;
  index?: number;
}) {
  const { add } = useCart();
  const level = stockLevel(product.inventory);
  const soldOut = level === "out";

  // Pointer-tracked 3D tilt on the image tile.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-0.5, 0.5], [9, -9]), {
    stiffness: 250,
    damping: 18,
  });
  const ry = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), {
    stiffness: 250,
    damping: 18,
  });

  const onMove = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };
  const reset = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{
        duration: 0.5,
        delay: Math.min(index * 0.06, 0.4),
        ease: [0.22, 1, 0.36, 1],
      }}
      className="group flex flex-col"
    >
      <motion.div
        onMouseMove={onMove}
        onMouseLeave={reset}
        style={{ perspective: 900 }}
      >
        <Link
          to={`/product/${product.sku}`}
          className="relative block aspect-[4/5] overflow-hidden rounded-2xl bg-cream-dark"
        >
          <motion.div
            style={{ rotateX: rx, rotateY: ry }}
            className="h-full w-full"
          >
            <ProductImage
              product={product}
              className="h-full w-full transition-transform duration-700 ease-smooth group-hover:scale-105"
            />
          </motion.div>
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${STOCK_STYLES[level]}`}
          >
            {stockLabel(product.inventory)}
          </span>
          <span className="absolute right-3 top-3 rounded-full bg-cream/85 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-soft backdrop-blur">
            {categoryFor(product)}
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 bottom-3 translate-y-3 rounded-full bg-maroon-700/95 py-2 text-center text-[11px] font-medium uppercase tracking-wider text-cream opacity-0 backdrop-blur transition-all duration-300 ease-smooth group-hover:translate-y-0 group-hover:opacity-100"
          >
            View product
          </span>
        </Link>
      </motion.div>

      <div className="mt-4 flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-muted">
              {product.sku}
            </p>
            <Link
              to={`/product/${product.sku}`}
              className="font-display text-lg font-semibold leading-tight tracking-tightest text-ink hover:text-maroon-700"
            >
              {product.name}
            </Link>
          </div>
          <span className="shrink-0 font-display text-lg font-semibold tracking-tightest">
            {money(product.price_cents)}
          </span>
        </div>

        <button
          onClick={() => add(product.sku)}
          disabled={soldOut}
          className="btn-primary mt-4 w-full"
        >
          {soldOut ? "Sold out" : "Add to bag"}
        </button>
      </div>
    </motion.article>
  );
}

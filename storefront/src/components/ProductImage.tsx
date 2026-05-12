import { useState } from "react";
import type { Product } from "../lib/api";
import { gradientFor, monogram, photoFor } from "../lib/products";

interface Props {
  product: Pick<Product, "sku" | "name">;
  className?: string;
  /** Larger monogram for hero / detail usage. */
  big?: boolean;
}

/**
 * Product imagery with a graceful fallback. Tries a curated/keyword photo
 * first; if it fails to load (or none exists) it renders a deterministic
 * gradient tile with the product monogram - so the grid never looks broken,
 * even when the catalog gets brand-new SKUs.
 */
export default function ProductImage({ product, className = "", big }: Props) {
  const src = photoFor(product);
  const [failed, setFailed] = useState(false);
  const [from, to] = gradientFor(product.sku);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        aria-label={product.name}
      >
        <span
          className={`font-display font-semibold text-cream/95 ${
            big ? "text-[7rem]" : "text-6xl"
          }`}
        >
          {monogram(product.name)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={product.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

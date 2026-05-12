import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useCart } from "../state/cart";

const NAV = [
  { to: "/", label: "Home" },
  { to: "/shop", label: "Shop" },
  { to: "/about", label: "Architecture" },
];

export default function Navbar() {
  const { count, openDrawer } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header
      className={[
        "fixed inset-x-0 top-0 z-[120] transition-all duration-500 ease-smooth",
        scrolled
          ? "bg-cream/80 backdrop-blur-xl shadow-[0_1px_0_rgba(21,17,15,0.08)]"
          : "bg-transparent",
      ].join(" ")}
    >
      <div className="container-x flex items-center justify-between py-4">
        <Link to="/" className="group flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-maroon-700 font-display text-lg font-bold text-cream transition-transform duration-300 ease-smooth group-hover:-rotate-6">
            G
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-display text-lg font-semibold tracking-tightest text-ink">
              GIKI Mart
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] text-ink-muted">
              Resilient Commerce
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-9 md:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "link-underline text-sm font-medium transition-colors",
                  isActive ? "text-maroon-700" : "text-ink-soft hover:text-ink",
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={openDrawer}
            className="group relative flex items-center gap-2 rounded-full bg-maroon-800 px-4 py-2.5 text-sm font-medium text-cream transition-all duration-300 ease-smooth hover:bg-maroon-700 active:scale-[0.97]"
            aria-label="Open bag"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-4 w-4"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            <span>Bag</span>
            <motion.span
              key={count}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="grid h-5 min-w-5 place-items-center rounded-full bg-cream px-1.5 text-[11px] font-bold text-ink"
            >
              {count}
            </motion.span>
          </button>

          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="grid h-10 w-10 place-items-center rounded-full border border-ink/15 md:hidden"
            aria-label="Toggle menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="h-5 w-5"
            >
              {menuOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <motion.nav
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden border-t border-ink/10 bg-cream/95 backdrop-blur-xl md:hidden"
        >
          <div className="container-x flex flex-col py-3">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "py-3 text-base font-medium",
                    isActive ? "text-maroon-700" : "text-ink-soft",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </motion.nav>
      )}
    </header>
  );
}

import { motion } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Wraps every routed page so AnimatePresence (mode="wait" in App) can
 * cross-fade between routes. Also adds the top padding that clears the
 * fixed navbar.
 */
export default function Page({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

import { motion, useScroll, useSpring } from "framer-motion";

// Thin maroon bar pinned to the very top, scaling with page scroll progress.
export default function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 30,
    mass: 0.3,
  });
  return (
    <motion.div
      aria-hidden
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[200] h-0.5 origin-left bg-sage"
    />
  );
}

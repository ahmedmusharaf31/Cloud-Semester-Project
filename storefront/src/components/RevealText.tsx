import { motion } from "framer-motion";

// Kinetic headline: splits text into words that rise + fade into place with a
// stagger when scrolled into view. Lines are passed as an array; each entry
// can be a plain string or { text, accent } to italicise + tint that line.
type Line = string | { text: string; accent?: boolean };

export default function RevealText({
  lines,
  className = "",
  delay = 0,
}: {
  lines: Line[];
  className?: string;
  delay?: number;
}) {
  let wordIndex = 0;
  return (
    <span className={className}>
      {lines.map((line, li) => {
        const text = typeof line === "string" ? line : line.text;
        const accent = typeof line === "object" && line.accent;
        return (
          <span key={li} className="block">
            {text.split(" ").map((word) => {
              const i = wordIndex++;
              return (
                <span key={`${word}-${i}`}>
                  <motion.span
                    className={`inline-block ${
                      accent ? "italic text-maroon-700" : ""
                    }`}
                    initial={{ y: "0.4em", opacity: 0 }}
                    whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{
                      duration: 0.6,
                      delay: delay + i * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {word}
                  </motion.span>{" "}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}

// Infinite horizontal ticker. Duplicates its track so the loop is seamless;
// direction flips the scroll. Pauses on hover for readability.
export default function Marquee({
  items,
  reverse = false,
  className = "",
}: {
  items: string[];
  reverse?: boolean;
  className?: string;
}) {
  const track = [...items, ...items, ...items, ...items];
  return (
    <div className={`group flex overflow-hidden ${className}`}>
      <div
        className={`flex w-max gap-10 whitespace-nowrap ${
          reverse ? "animate-marquee-rev" : "animate-marquee"
        } group-hover:[animation-play-state:paused]`}
      >
        {track.map((word, i) => (
          <span
            key={i}
            className="flex items-center gap-10 font-display text-lg italic tracking-tightest"
          >
            {word}
            <span className="text-maroon-400">✦</span>
          </span>
        ))}
      </div>
    </div>
  );
}

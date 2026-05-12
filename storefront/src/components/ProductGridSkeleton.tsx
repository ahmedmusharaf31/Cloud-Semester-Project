export default function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-10 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col">
          <div className="skeleton aspect-[4/5] rounded-2xl" />
          <div className="mt-4 space-y-2">
            <div className="skeleton h-3 w-1/3 rounded" />
            <div className="skeleton h-4 w-3/4 rounded" />
            <div className="skeleton mt-3 h-10 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

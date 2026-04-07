export default function MotsClesLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-36 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-32 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-8 bg-bg-tertiary rounded-full" style={{ width: `${60 + (i % 4) * 20}px` }} />
        ))}
      </div>
    </div>
  );
}

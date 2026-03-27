export default function AdminProductsLoading() {
  return (
    <div className="w-full space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-bg-tertiary rounded-lg" />
        <div className="h-10 w-36 bg-bg-tertiary rounded-xl" />
      </div>
      <div className="card overflow-hidden w-full">
        <div className="table-header h-12 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="table-row h-16 flex items-center gap-4 px-4 w-full">
            <div className="w-10 h-10 bg-bg-tertiary rounded-lg shrink-0" />
            <div className="h-4 bg-bg-tertiary rounded flex-[3]" />
            <div className="h-3 bg-bg-tertiary rounded flex-[2]" />
            <div className="flex-[4]" />
            <div className="h-5 w-16 bg-bg-tertiary rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

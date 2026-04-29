export default function OrdersLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-48 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-5 flex items-center gap-4">
            <div className="h-5 w-32 bg-[#E5E5E5] rounded" />
            <div className="h-4 w-24 bg-[#E5E5E5] rounded" />
            <div className="flex-1" />
            <div className="h-6 w-20 bg-[#E5E5E5] rounded-full" />
            <div className="h-5 w-16 bg-[#E5E5E5] rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

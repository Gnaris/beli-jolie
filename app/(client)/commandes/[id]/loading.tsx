export default function OrderDetailLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-56 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-5 flex items-center gap-4">
              <div className="h-16 w-16 bg-[#E5E5E5] rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 bg-[#E5E5E5] rounded" />
                <div className="h-3 w-24 bg-[#E5E5E5] rounded" />
              </div>
              <div className="h-5 w-16 bg-[#E5E5E5] rounded" />
            </div>
          ))}
        </div>
        <div className="card p-5 h-48" />
      </div>
    </div>
  );
}

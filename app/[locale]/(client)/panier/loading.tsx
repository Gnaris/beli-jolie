export default function CartLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-32 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4 flex gap-4">
              <div className="w-20 h-20 bg-[#E5E5E5] rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 bg-[#E5E5E5] rounded" />
                <div className="h-3 w-1/3 bg-[#E5E5E5] rounded" />
                <div className="h-4 w-20 bg-[#E5E5E5] rounded" />
              </div>
            </div>
          ))}
        </div>
        <div className="card p-5 h-56">
          <div className="space-y-3">
            <div className="h-4 w-full bg-[#E5E5E5] rounded" />
            <div className="h-4 w-full bg-[#E5E5E5] rounded" />
            <div className="h-px bg-[#E5E5E5] my-2" />
            <div className="h-6 w-1/2 bg-[#E5E5E5] rounded" />
            <div className="h-12 w-full bg-[#E5E5E5] rounded-xl mt-4" />
          </div>
        </div>
      </div>
    </div>
  );
}

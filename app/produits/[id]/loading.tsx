export default function ProductDetailLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="aspect-square bg-[#E5E5E5] rounded-2xl" />
        <div className="space-y-4 py-4">
          <div className="h-6 w-3/4 bg-[#E5E5E5] rounded-lg" />
          <div className="h-4 w-1/3 bg-[#E5E5E5] rounded" />
          <div className="h-8 w-28 bg-[#E5E5E5] rounded-lg mt-2" />
          <div className="flex gap-2 mt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-8 h-8 bg-[#E5E5E5] rounded-full" />
            ))}
          </div>
          <div className="h-12 w-full bg-[#E5E5E5] rounded-xl mt-6" />
          <div className="space-y-2 mt-6">
            <div className="h-3 w-full bg-[#E5E5E5] rounded" />
            <div className="h-3 w-5/6 bg-[#E5E5E5] rounded" />
            <div className="h-3 w-2/3 bg-[#E5E5E5] rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CollectionsLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-40 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden">
            <div className="aspect-[4/3] bg-[#E5E5E5] rounded-xl" />
            <div className="pt-3 space-y-2">
              <div className="h-5 w-1/2 bg-[#E5E5E5] rounded" />
              <div className="h-3 w-3/4 bg-[#E5E5E5] rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

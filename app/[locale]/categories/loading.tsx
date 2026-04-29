export default function CategoriesLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-40 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden">
            <div className="aspect-square bg-[#E5E5E5] rounded-xl" />
            <div className="pt-3">
              <div className="h-5 w-2/3 bg-[#E5E5E5] rounded mx-auto" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

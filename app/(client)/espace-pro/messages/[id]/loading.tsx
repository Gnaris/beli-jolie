export default function MessageDetailLoading() {
  return (
    <div className="p-6 md:p-10 space-y-4 animate-pulse">
      <div className="h-6 w-32 bg-gray-200 rounded" />
      <div className="card p-5 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
            <div className="h-12 w-2/3 bg-gray-200 rounded-xl" />
          </div>
        ))}
      </div>
      <div className="h-12 w-full bg-gray-200 rounded-xl" />
    </div>
  );
}

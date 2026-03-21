export default function AdminDashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-bg-tertiary rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-card h-28">
            <div className="h-4 w-20 bg-bg-tertiary rounded" />
            <div className="h-8 w-16 bg-bg-tertiary rounded mt-3" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card h-72"><div className="h-full bg-bg-tertiary rounded-xl" /></div>
        <div className="card h-72"><div className="h-full bg-bg-tertiary rounded-xl" /></div>
      </div>
    </div>
  );
}

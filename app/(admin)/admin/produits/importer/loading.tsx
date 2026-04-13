export default function ImporterLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 bg-bg-tertiary rounded-lg" />
      <div className="card p-6 space-y-4">
        <div className="h-5 w-40 bg-bg-tertiary rounded" />
        <div className="h-32 w-full bg-bg-tertiary rounded-xl" />
        <div className="h-10 w-36 bg-bg-tertiary rounded-xl" />
      </div>
    </div>
  );
}

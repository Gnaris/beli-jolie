export default function Loading() {
  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-80 bg-bg-secondary rounded" />
        <div className="h-4 w-full max-w-2xl bg-bg-secondary rounded" />
      </div>
      <div className="h-10 w-full bg-bg-secondary rounded-xl" />
      <div className="h-96 w-full bg-bg-secondary rounded-xl" />
    </div>
  );
}

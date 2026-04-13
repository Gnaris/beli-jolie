export default function NouvelleCollectionLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-52 bg-bg-tertiary rounded-lg" />
      <div className="card p-6 space-y-4">
        <div className="h-5 w-32 bg-bg-tertiary rounded" />
        <div className="h-10 w-full bg-bg-tertiary rounded-xl" />
        <div className="h-10 w-full bg-bg-tertiary rounded-xl" />
      </div>
      <div className="card p-6 space-y-4">
        <div className="h-5 w-28 bg-bg-tertiary rounded" />
        <div className="h-40 w-full bg-bg-tertiary rounded-xl" />
      </div>
    </div>
  );
}

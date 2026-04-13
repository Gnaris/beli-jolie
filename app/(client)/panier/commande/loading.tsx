export default function CheckoutLoading() {
  return (
    <div className="container-site py-8 animate-pulse">
      <div className="h-8 w-48 bg-[#E5E5E5] rounded-lg mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5 space-y-4">
            <div className="h-5 w-40 bg-[#E5E5E5] rounded" />
            <div className="h-10 w-full bg-[#E5E5E5] rounded-xl" />
            <div className="h-10 w-full bg-[#E5E5E5] rounded-xl" />
          </div>
          <div className="card p-5 space-y-4">
            <div className="h-5 w-36 bg-[#E5E5E5] rounded" />
            <div className="h-10 w-full bg-[#E5E5E5] rounded-xl" />
          </div>
        </div>
        <div className="card p-5 h-56" />
      </div>
    </div>
  );
}

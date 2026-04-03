"use client";

const STEPS = [
  { status: "PENDING", label: "Confirmee" },
  { status: "PROCESSING", label: "En traitement" },
  { status: "SHIPPED", label: "Expediee" },
  { status: "DELIVERED", label: "Livree" },
];

interface OrderTimelineProps {
  status: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED";
}

export default function OrderTimeline({ status }: OrderTimelineProps) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[#EF4444] flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <span className="text-sm font-body text-[#EF4444] font-semibold">Annulee</span>
      </div>
    );
  }

  const currentIndex = STEPS.findIndex((s) => s.status === status);

  return (
    <div className="flex items-center gap-0 w-full">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIndex;
        const isActive = i === currentIndex;
        return (
          <div key={step.status} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  isCompleted
                    ? "bg-[#22C55E] text-white"
                    : isActive
                    ? "bg-[#1A1A1A] text-white"
                    : "bg-bg-secondary text-text-muted"
                }`}
              >
                {isCompleted ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[10px] font-body whitespace-nowrap ${isActive ? "text-text-primary font-semibold" : "text-text-muted"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 ${isCompleted ? "bg-[#22C55E]" : "bg-border"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

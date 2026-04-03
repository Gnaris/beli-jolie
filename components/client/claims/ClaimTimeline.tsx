"use client";

const MAIN_STEPS = [
  { status: "OPEN", label: "Ouverte" },
  { status: "IN_REVIEW", label: "En examen" },
  { status: "ACCEPTED", label: "Acceptee" },
  { status: "RESOLVED", label: "Resolue" },
  { status: "CLOSED", label: "Fermee" },
];

const RETURN_STEPS = [
  { status: "RETURN_PENDING", label: "Retour demande" },
  { status: "RETURN_SHIPPED", label: "Retour expedie" },
  { status: "RETURN_RECEIVED", label: "Retour recu" },
];

const REJECTED_PATH = [
  { status: "OPEN", label: "Ouverte" },
  { status: "IN_REVIEW", label: "En examen" },
  { status: "REJECTED", label: "Refusee" },
  { status: "CLOSED", label: "Fermee" },
];

function getSteps(currentStatus: string, hasReturn: boolean) {
  if (["REJECTED"].includes(currentStatus) || currentStatus === "CLOSED") {
    // Check if it was rejected
    return REJECTED_PATH;
  }

  if (hasReturn || ["RETURN_PENDING", "RETURN_SHIPPED", "RETURN_RECEIVED"].includes(currentStatus)) {
    const base = MAIN_STEPS.slice(0, 3); // OPEN, IN_REVIEW, ACCEPTED
    return [...base, ...RETURN_STEPS, ...MAIN_STEPS.slice(3)]; // + RETURN steps + RESOLVED, CLOSED
  }

  return MAIN_STEPS;
}

function getStepState(stepStatus: string, currentStatus: string, steps: { status: string }[]): "completed" | "active" | "pending" {
  const currentIndex = steps.findIndex((s) => s.status === currentStatus);
  const stepIndex = steps.findIndex((s) => s.status === stepStatus);

  if (stepIndex < currentIndex) return "completed";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

export default function ClaimTimeline({ status, hasReturn = false }: { status: string; hasReturn?: boolean }) {
  const steps = getSteps(status, hasReturn);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-0 w-full overflow-x-auto py-2">
      {steps.map((step, i) => {
        const state = getStepState(step.status, status, steps);
        return (
          <div key={step.status} className="flex items-center gap-2 sm:flex-1">
            <div className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  state === "completed"
                    ? "bg-[#22C55E] text-white"
                    : state === "active"
                    ? "bg-[#1A1A1A] text-white"
                    : "bg-bg-secondary text-text-muted"
                }`}
              >
                {state === "completed" ? (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-xs font-body whitespace-nowrap ${
                  state === "active" ? "text-text-primary font-semibold" : "text-text-muted"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`hidden sm:block flex-1 h-0.5 mx-2 ${
                  state === "completed" ? "bg-[#22C55E]" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

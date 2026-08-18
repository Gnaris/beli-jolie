"use client";

import { useTranslations } from "next-intl";

type Step = 1 | 2 | 3;

/**
 * Fil d'étapes horizontal : 3 cercles reliés par des lignes, équidistants.
 * Étape 1 alignée à gauche, étape 2 au centre, étape 3 à droite.
 */
export default function WizardStepper({
  currentStep,
  onGoTo,
  canGoStep2,
  canGoStep3,
}: {
  currentStep: Step;
  onGoTo: (s: Step) => void;
  canGoStep2: boolean;
  canGoStep3: boolean;
}) {
  const t = useTranslations("cart");
  const steps: { n: Step; label: string; align: string }[] = [
    { n: 1, label: t("stepCart"),     align: "justify-start" },
    { n: 2, label: t("stepDelivery"), align: "justify-center" },
    { n: 3, label: t("stepPayment"),  align: "justify-end" },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 md:p-4">
      <div className="relative grid grid-cols-3 items-center">
        {/* Ligne 1 : de la fin du cercle 1 (36px du bord gauche) au début du
            cercle 2 (50%). Ligne 2 : du cercle 2 (50%) à la fin du cercle 3
            (36px du bord droit). Ces valeurs correspondent au diamètre du
            cercle (w-9 = 36px) et à sa position selon `justify-*`. */}
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full ${
            currentStep >= 2 ? "bg-slate-900" : "bg-slate-200"
          }`}
          style={{ left: 36, right: "50%" }}
        />
        <span
          aria-hidden="true"
          className={`absolute top-1/2 -translate-y-1/2 h-0.5 rounded-full ${
            currentStep >= 3 ? "bg-slate-900" : "bg-slate-200"
          }`}
          style={{ left: "50%", right: 36 }}
        />

        {steps.map((s) => {
          const isActive = s.n === currentStep;
          const isDone = s.n < currentStep;
          const canClick =
            s.n < currentStep ||
            (s.n === 2 && canGoStep2) ||
            (s.n === 3 && canGoStep3);

          return (
            <div key={s.n} className={`flex ${s.align}`}>
              <button
                type="button"
                onClick={() => canClick && onGoTo(s.n)}
                disabled={!canClick}
                aria-current={isActive ? "step" : undefined}
                className={`relative z-10 flex items-center gap-3 bg-white px-2 ${canClick ? "cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center text-sm font-semibold transition-colors ${
                    isActive
                      ? "bg-slate-900 text-white"
                      : isDone
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {isDone ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s.n
                  )}
                </span>
                <span className="hidden sm:block">
                  <span
                    className={`block text-sm font-semibold leading-tight whitespace-nowrap ${
                      isActive ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {s.label}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

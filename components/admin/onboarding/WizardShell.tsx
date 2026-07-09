"use client";
import React, { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { skipOnboarding } from "@/app/actions/admin/onboarding";
import type { OnboardingStep } from "@/lib/onboarding";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

const STEPS: {
  id: Exclude<OnboardingStep, "done">;
  title: string;
  subtitle: string;
  path: string;
}[] = [
  { id: "welcome",  title: "Bienvenue",       subtitle: "Découverte",        path: "/admin/bienvenue" },
  { id: "company",  title: "Votre société",   subtitle: "SIRET, adresse",    path: "/admin/bienvenue/societe" },
  { id: "brand",    title: "Logo & couleur",  subtitle: "Identité visuelle", path: "/admin/bienvenue/marque" },
  { id: "stripe",   title: "Encaissement",    subtitle: "Stripe",            path: "/admin/bienvenue/stripe" },
  { id: "email",    title: "E-mails",         subtitle: "Boîte pro",         path: "/admin/bienvenue/email" },
  { id: "shipping", title: "Livraison",       subtitle: "Easy-Express",      path: "/admin/bienvenue/livraison" },
  { id: "legal",    title: "CGV & légal",     subtitle: "Documents",         path: "/admin/bienvenue/legal" },
];

export default function WizardShell({
  currentPath,
  stepsCompleted,
  children,
}: {
  currentPath: string;
  stepsCompleted: OnboardingStep[];
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm } = useConfirm();
  const toast = useToast();

  const activeIndex = Math.max(
    0,
    STEPS.findIndex((s) => currentPath === s.path || currentPath.startsWith(`${s.path}/`)),
  );
  const totalSteps = STEPS.length;
  const progressPct = ((activeIndex + 1) / totalSteps) * 100;

  const handleSkip = async () => {
    const ok = await confirm({
      type: "warning",
      title: "Passer et configurer plus tard ?",
      message:
        "Vous pourrez revenir à cette configuration depuis Paramètres. Votre boutique ne sera pas visible tant que vous n'aurez pas au moins renseigné la société.",
      confirmLabel: "Passer",
      cancelLabel: "Continuer le wizard",
    });
    if (ok !== true) return;
    startTransition(async () => {
      const res = await skipOnboarding();
      if (res.success) {
        toast.success("Configuration reportée", "Vous pourrez la reprendre plus tard.");
        router.push("/admin");
      } else {
        toast.error("Erreur", res.error ?? "Impossible de passer l'étape.");
      }
    });
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(1200px 500px at 90% -10%, rgba(196,181,253,0.35), transparent 60%)," +
          "radial-gradient(1000px 500px at -10% 20%, rgba(167,243,208,0.35), transparent 60%)," +
          "radial-gradient(700px 400px at 60% 100%, rgba(253,230,138,0.30), transparent 60%)," +
          "linear-gradient(180deg, #fbfaf7 0%, #fefdfb 100%)",
      }}
    >
      <header className="sticky top-0 z-40 border-b border-black/5 bg-white/70 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-heading font-bold text-lg shadow-lg">
              M
            </div>
            <div>
              <p className="text-sm text-text-secondary leading-tight">Ma boutique</p>
              <p className="font-semibold text-text-primary leading-tight">Configuration</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2">
              <div className="w-32 h-2 bg-border/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-sm text-text-secondary">
                Étape {activeIndex + 1} / {totalSteps}
              </span>
            </div>
            <button
              onClick={handleSkip}
              disabled={isPending}
              className="text-sm text-text-secondary hover:text-text-primary disabled:opacity-50"
              type="button"
            >
              Passer et configurer plus tard →
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-12 gap-8">
          <aside className="col-span-12 md:col-span-4 lg:col-span-3">
            <div className="bg-white/70 backdrop-blur rounded-2xl p-4 shadow-sm sticky top-24">
              <p className="text-[11px] uppercase tracking-[0.18em] text-violet-600 font-semibold mb-3 px-2 flex items-center gap-2">
                <span className="w-1 h-3 bg-violet-500 rounded" /> Configuration
              </p>
              <ol className="space-y-1">
                {STEPS.map((step, i) => {
                  const isActive = i === activeIndex;
                  const isDone = stepsCompleted.includes(step.id);
                  return (
                    <li key={step.id}>
                      <Link
                        href={step.path}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition relative ${
                          isActive ? "bg-gradient-to-r from-violet-100/60 to-transparent" : "hover:bg-black/[0.03]"
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-gradient-to-b from-violet-500 to-indigo-600" />
                        )}
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isActive
                              ? "bg-gradient-to-br from-violet-500 to-indigo-600 text-white"
                              : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          {isDone ? "✓" : i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
                            {step.title}
                          </p>
                          <p className="text-xs text-text-secondary/70 truncate">{step.subtitle}</p>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          </aside>

          <main className="col-span-12 md:col-span-8 lg:col-span-9">
            <div className="bg-white/85 backdrop-blur rounded-3xl p-6 md:p-10 shadow-sm min-h-[520px]">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

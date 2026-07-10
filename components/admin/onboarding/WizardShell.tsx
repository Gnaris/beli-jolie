"use client";
import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { skipOnboarding } from "@/app/actions/admin/onboarding";
import type { OnboardingStep } from "@/lib/onboarding";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import {
  WizardBrandingProvider,
  shopInitial,
  useWizardBranding,
} from "./WizardBrandingContext";
import WizardSheet, { type SheetStep } from "./WizardSheet";

type StepDef = {
  id: Exclude<OnboardingStep, "done">;
  title: string;
  subtitle: string;
  path: string;
};

const STEPS: StepDef[] = [
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
  initialShopName,
  children,
}: {
  currentPath: string;
  stepsCompleted: OnboardingStep[];
  initialShopName: string;
  children: React.ReactNode;
}) {
  return (
    <WizardBrandingProvider initialShopName={initialShopName}>
      <WizardShellInner
        currentPath={currentPath}
        stepsCompleted={stepsCompleted}
      >
        {children}
      </WizardShellInner>
    </WizardBrandingProvider>
  );
}

function WizardShellInner({
  currentPath,
  stepsCompleted,
  children,
}: {
  currentPath: string;
  stepsCompleted: OnboardingStep[];
  children: React.ReactNode;
}) {
  const { shopName } = useWizardBranding();
  const displayName = shopName.trim() || "Ma boutique";
  const initial = shopInitial(shopName);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { confirm } = useConfirm();
  const toast = useToast();

  const isDoneStep = currentPath === "/admin/bienvenue/done";
  const foundIndex = STEPS.findIndex(
    (s) => currentPath === s.path || currentPath.startsWith(`${s.path}/`),
  );
  const activeIndex = isDoneStep ? STEPS.length : Math.max(0, foundIndex);
  const totalSteps = STEPS.length;
  const displayedStep = isDoneStep ? totalSteps : activeIndex + 1;
  const progressPct = isDoneStep
    ? 100
    : (displayedStep / totalSteps) * 100;

  const activeStep = STEPS[Math.min(activeIndex, totalSteps - 1)];
  const activeTitle = isDoneStep ? "C'est prêt !" : activeStep.title;

  const sheetSteps: SheetStep[] = STEPS.map((s, i) => {
    const isDone = stepsCompleted.includes(s.id);
    const isActive = !isDoneStep && i === activeIndex;
    return {
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      index: i,
      state: isActive ? "active" : isDone ? "done" : "future",
    };
  });

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

  const handleLogout = async () => {
    const ok = await confirm({
      type: "info",
      title: "Se déconnecter ?",
      message:
        "Vos réponses déjà enregistrées sont conservées. À la prochaine connexion, vous reprendrez là où vous en étiez.",
      confirmLabel: "Se déconnecter",
      cancelLabel: "Rester connectée",
    });
    if (ok !== true) return;
    signOut({ callbackUrl: "/connexion" });
  };

  return (
    <div className="bj-wizard">
      <header className="bj-wizard-header">
        <div className="bj-wizard-header-inner">
          <div className="bj-brand">
            <div className="bj-brand-badge">
              <span key={initial} className="bj-brand-initial">{initial}</span>
            </div>
            <div className="bj-brand-text">
              <p title={displayName}>{displayName}</p>
              <p>Configuration</p>
            </div>
          </div>
          <div className="bj-header-actions">
            <button
              type="button"
              onClick={handleSkip}
              disabled={isPending}
              className="bj-btn-text bj-hide-below-sm"
            >
              Plus tard →
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={isPending}
              className="bj-icon-btn"
              title="Se déconnecter — votre progression est conservée"
              aria-label="Se déconnecter"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="bj-container">

        <div className="bj-step-info">
          <div className="bj-step-info-card">
            <div className="bj-step-info-num">{isDoneStep ? "✓" : displayedStep}</div>
            <div className="bj-step-info-text">
              <p>Étape {displayedStep} sur {totalSteps}</p>
              <p title={activeTitle}>{activeTitle}</p>
            </div>
            <button
              type="button"
              className="bj-step-info-open"
              onClick={() => setSheetOpen(true)}
            >
              Voir tout
            </button>
          </div>
          <div className="bj-step-info-bar"><div style={{ width: `${progressPct}%` }} /></div>
          <div className="bj-step-info-labels">
            <span>Progression</span>
            <strong>{Math.round(progressPct)}%</strong>
          </div>

          <div className="bj-stepper-h">
            <div className="bj-stepper-dots">
              {STEPS.map((s, i) => {
                const isDone = stepsCompleted.includes(s.id);
                const isActive = !isDoneStep && i === activeIndex;
                const state = isActive ? "active" : isDone ? "done" : "future";
                return (
                  <div key={s.id} className={`bj-stepper-dot bj-${state}`}>
                    <div className={`bj-stepper-circle bj-num-${state}`}>
                      {state === "done" ? "✓" : i + 1}
                    </div>
                    <span className="bj-stepper-label">{s.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bj-wizard-grid">
          <aside className="bj-sidebar">
            <p className="bj-sidebar-eyebrow">Votre parcours</p>
            <div className="bj-sidebar-progress">
              <div className="bj-sidebar-progress-labels">
                <span>Progression</span>
                <span>{Math.round(progressPct)}%</span>
              </div>
              <div className="bj-sidebar-bar"><div style={{ width: `${progressPct}%` }} /></div>
            </div>
            <ol className="bj-steps-list">
              {STEPS.map((s, i) => {
                const isDone = stepsCompleted.includes(s.id);
                const isActive = !isDoneStep && i === activeIndex;
                const state = isActive ? "active" : isDone ? "done" : "future";
                return (
                  <li key={s.id}>
                    <div className={`bj-step-node bj-${state}`}>
                      <span className={`bj-step-num bj-num-${state}`}>
                        {state === "done" ? "✓" : i + 1}
                      </span>
                      <div className="bj-step-text">
                        <p>{s.title}</p>
                        <p>
                          {state === "done" ? "Terminée" : state === "active" ? "▸ En cours" : "À venir"}
                        </p>
                      </div>
                      {state !== "active" && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="bj-step-lock" aria-hidden="true">
                          <rect x="3" y="11" width="18" height="11" rx="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="bj-sidebar-note">
              <strong>💾 Auto-sauvegarde</strong> — Vos réponses sont enregistrées à chaque étape.
            </p>
          </aside>

          <main className="bj-main">
            <div className="bj-step-card">
              <div className="bj-step-inner">
                {children}
              </div>
            </div>
            <p className="bj-footer-note">
              🔒 Vous avancez étape par étape. Cela garantit que rien ne manque.
            </p>
          </main>
        </div>
      </div>

      <WizardSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        steps={sheetSteps}
      />

      <style jsx>{`
        .bj-wizard {
          min-height: 100vh;
          background:
            radial-gradient(1200px 500px at 90% -10%, rgba(196,181,253,0.35), transparent 60%),
            radial-gradient(1000px 500px at -10% 20%, rgba(167,243,208,0.35), transparent 60%),
            radial-gradient(700px 400px at 60% 100%, rgba(253,230,138,0.30), transparent 60%),
            linear-gradient(180deg, #fbfaf7 0%, #fefdfb 100%);
          --pad-x: clamp(12px, 3.5vw, 32px);
          --gap: clamp(10px, 2vw, 18px);
          --gap-lg: clamp(16px, 3vw, 28px);
          --card-pad: clamp(16px, 4vw, 32px);
          --violet: #7c3aed;
          --pink: #ec4899;
          --emerald: #10b981;
        }
        .bj-container {
          max-width: 1200px; margin: 0 auto;
          padding-left: var(--pad-x); padding-right: var(--pad-x);
        }
        .bj-wizard-header {
          position: sticky; top: 0; z-index: 40;
          background: rgba(255,255,255,.8);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(0,0,0,.05);
        }
        .bj-wizard-header-inner {
          max-width: 1200px; margin: 0 auto;
          padding: 12px var(--pad-x);
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
        }
        .bj-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
        .bj-brand-badge {
          position: relative; overflow: hidden;
          width: clamp(36px, 8vw, 40px); height: clamp(36px, 8vw, 40px);
          border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #8b5cf6, #6366f1, #ec4899);
          color: white; font-family: var(--font-heading, 'Fraunces', serif); font-weight: 700;
          font-size: clamp(15px, 3vw, 18px);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 6px 16px rgba(124,58,237,.25);
        }
        .bj-brand-initial {
          animation: bj-brand-pop 260ms cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes bj-brand-pop {
          0% { transform: scale(.6); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        .bj-brand-text { min-width: 0; }
        .bj-brand-text p { margin: 0; }
        .bj-brand-text p:first-child {
          font-size: clamp(10px, 2.4vw, 11px); color: #6b7280; line-height: 1.1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 18ch;
        }
        .bj-brand-text p:last-child {
          font-size: clamp(13px, 2.8vw, 14px); font-weight: 600; color: #111827; line-height: 1.2;
        }
        .bj-header-actions { display: flex; align-items: center; gap: 6px; }
        .bj-btn-text {
          background: none; border: 0; cursor: pointer;
          font-size: 12px; color: #6b7280; padding: 8px 10px; border-radius: 8px;
        }
        .bj-btn-text:hover:not(:disabled) { color: #111827; background: rgba(0,0,0,.03); }
        .bj-btn-text:disabled { opacity: .5; cursor: not-allowed; }
        .bj-icon-btn {
          width: 38px; height: 38px; border-radius: 50%;
          display: inline-flex; align-items: center; justify-content: center;
          background: white; border: 1px solid rgba(0,0,0,.08); cursor: pointer;
          color: #4b5563; transition: all .15s;
        }
        .bj-icon-btn:hover:not(:disabled) { color: #111827; border-color: rgba(0,0,0,.2); background: #f9fafb; }
        .bj-icon-btn:disabled { opacity: .5; cursor: not-allowed; }
        @media (max-width: 640px) { .bj-hide-below-sm { display: none !important; } }

        /* Step info compact (< 1024px) */
        .bj-step-info { padding: 16px 0 12px; display: none; }
        @media (max-width: 1023px) { .bj-step-info { display: block; } }
        .bj-step-info-card {
          background: linear-gradient(135deg, rgba(139,92,246,.08), rgba(236,72,153,.05));
          border: 1px solid #ede9fe;
          border-radius: 16px;
          padding: 14px 16px;
          display: flex; align-items: center; gap: 12px;
        }
        .bj-step-info-num {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, #8b5cf6, #ec4899);
          color: white; font-weight: 700; font-size: 15px;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; box-shadow: 0 4px 12px rgba(124,58,237,.3);
          animation: bj-pulse-ring 2s infinite;
        }
        .bj-step-info-text { flex: 1; min-width: 0; }
        .bj-step-info-text p { margin: 0; }
        .bj-step-info-text p:first-child {
          font-size: 10px; text-transform: uppercase; letter-spacing: .12em;
          color: var(--violet); font-weight: 700; line-height: 1;
        }
        .bj-step-info-text p:last-child {
          font-family: var(--font-heading, 'Fraunces', serif); font-weight: 700; font-size: 16px;
          color: #111827; margin-top: 4px; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .bj-step-info-open {
          background: white; border: 0; cursor: pointer;
          padding: 8px 12px; border-radius: 999px;
          font-size: 11px; font-weight: 600; color: var(--violet);
          flex-shrink: 0; box-shadow: 0 2px 6px rgba(124,58,237,.15);
        }
        .bj-step-info-open:hover { background: #fdf4ff; }
        .bj-step-info-bar {
          margin-top: 10px; height: 5px; background: rgba(0,0,0,.06);
          border-radius: 999px; overflow: hidden;
        }
        .bj-step-info-bar > div {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6, #6366f1, #ec4899);
          border-radius: 999px; transition: width .5s ease;
        }
        .bj-step-info-labels {
          display: flex; justify-content: space-between; align-items: baseline;
          margin-top: 6px; font-size: 10px; color: #6b7280;
        }
        .bj-step-info-labels strong { color: var(--violet); }

        /* Stepper 7-dots (640px - 1023px) */
        .bj-stepper-h { display: none; }
        @media (min-width: 640px) and (max-width: 1023px) {
          .bj-stepper-h {
            display: block; margin-top: 14px; padding: 14px 16px;
            background: white; border-radius: 16px; border: 1px solid #f3f4f6;
          }
        }
        .bj-stepper-dots {
          display: flex; align-items: flex-start; justify-content: space-between;
          gap: 6px; position: relative;
        }
        .bj-stepper-dot {
          flex: 1; display: flex; flex-direction: column; align-items: center;
          position: relative; min-width: 0;
        }
        .bj-stepper-dot::after {
          content: ''; position: absolute; top: 14px;
          left: calc(50% + 16px); right: calc(-50% + 16px); height: 2px;
          background: #e5e7eb; z-index: 0;
        }
        .bj-stepper-dot:last-child::after { display: none; }
        .bj-stepper-dot.bj-done::after { background: var(--emerald); }
        .bj-stepper-circle {
          width: 28px; height: 28px; border-radius: 50%; z-index: 1;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; transition: all .3s;
        }
        .bj-num-done { background: var(--emerald); color: white; }
        .bj-num-active {
          background: linear-gradient(135deg, #8b5cf6, #ec4899);
          color: white;
        }
        .bj-num-future { background: white; color: #9ca3af; border: 2px solid #e5e7eb; }
        .bj-stepper-dot.bj-active .bj-stepper-circle {
          width: 34px; height: 34px; font-size: 13px;
          box-shadow: 0 4px 12px rgba(124,58,237,.35);
          animation: bj-pulse-ring 2s infinite;
        }
        .bj-stepper-label {
          font-size: 10px; color: #6b7280; margin-top: 6px;
          text-align: center; line-height: 1.1;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
        }
        .bj-stepper-dot.bj-active .bj-stepper-label { color: var(--violet); font-weight: 700; }

        @keyframes bj-pulse-ring {
          0% { box-shadow: 0 0 0 0 rgba(124,58,237,.5); }
          70% { box-shadow: 0 0 0 12px rgba(124,58,237,0); }
          100% { box-shadow: 0 0 0 0 rgba(124,58,237,0); }
        }

        /* Grid */
        .bj-wizard-grid {
          display: grid; grid-template-columns: 1fr; gap: var(--gap-lg);
          padding-bottom: clamp(20px, 4vw, 40px);
        }
        @media (min-width: 1024px) {
          .bj-wizard-grid {
            grid-template-columns: 260px 1fr;
            padding-top: clamp(20px, 4vw, 40px);
          }
        }

        /* Sidebar desktop */
        .bj-sidebar { display: none; }
        @media (min-width: 1024px) {
          .bj-sidebar {
            display: block; position: sticky; top: 80px; align-self: start;
            background: rgba(255,255,255,.85);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-radius: 24px; padding: 20px;
            box-shadow: 0 4px 14px rgba(0,0,0,.04);
            border: 1px solid white; z-index: 30;
          }
        }
        .bj-sidebar-eyebrow {
          font-size: 11px; text-transform: uppercase; letter-spacing: .18em;
          color: var(--violet); font-weight: 700; margin: 0 4px 12px;
          display: flex; align-items: center; gap: 8px;
        }
        .bj-sidebar-eyebrow::before {
          content: ''; width: 3px; height: 12px; background: var(--violet); border-radius: 2px;
        }
        .bj-sidebar-progress { margin: 0 4px 16px; }
        .bj-sidebar-progress-labels {
          display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;
        }
        .bj-sidebar-progress-labels span:first-child { font-size: 12px; color: #6b7280; }
        .bj-sidebar-progress-labels span:last-child { font-size: 12px; font-weight: 700; color: var(--violet); }
        .bj-sidebar-bar {
          height: 5px; background: rgba(0,0,0,.06);
          border-radius: 999px; overflow: hidden;
        }
        .bj-sidebar-bar > div {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6, #6366f1, #ec4899);
          border-radius: 999px; transition: width .5s ease;
        }
        .bj-steps-list { list-style: none; padding: 0; margin: 0; position: relative; }
        .bj-steps-list::before {
          content: ''; position: absolute; left: 21px; top: 16px; bottom: 16px;
          width: 1px; background: linear-gradient(to bottom, var(--emerald), #a78bfa, #e5e7eb);
        }
        .bj-step-node {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 8px; border-radius: 12px; position: relative;
          transition: all .3s;
        }
        .bj-step-node.bj-done { opacity: .55; }
        .bj-step-node.bj-future { opacity: .55; }
        .bj-step-num {
          width: 26px; height: 26px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; flex-shrink: 0; z-index: 1;
        }
        .bj-step-node.bj-active .bj-step-num {
          animation: bj-pulse-ring 2s infinite;
        }
        .bj-step-text { flex: 1; min-width: 0; }
        .bj-step-text p { margin: 0; }
        .bj-step-text p:first-child {
          font-size: 13px; font-weight: 600; color: #4b5563; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .bj-step-text p:last-child {
          font-size: 11px; color: #9ca3af; margin-top: 2px; line-height: 1.2;
        }
        .bj-step-node.bj-active {
          background: linear-gradient(135deg, rgba(139,92,246,.12), rgba(236,72,153,.05));
          box-shadow: inset 3px 0 0 0 var(--violet);
        }
        .bj-step-node.bj-active .bj-step-text p:first-child { color: #111827; font-weight: 700; }
        .bj-step-node.bj-active .bj-step-text p:last-child { color: var(--violet); font-weight: 600; }
        .bj-step-lock { color: #9ca3af; flex-shrink: 0; }
        .bj-sidebar-note {
          margin: 16px 4px 0; padding: 10px 12px;
          border-radius: 12px;
          background: linear-gradient(135deg, #f5f3ff, #fdf2f8);
          border: 1px solid #ede9fe;
          font-size: 11px; color: #6d28d9; line-height: 1.4;
        }
        .bj-sidebar-note strong { color: #5b21b6; }

        /* Main / step card */
        .bj-main { min-width: 0; }
        .bj-step-card {
          background: rgba(255,255,255,.9);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          border-radius: 24px; padding: var(--card-pad);
          box-shadow: 0 4px 14px rgba(0,0,0,.04);
          border: 1px solid white; position: relative; overflow: hidden;
          animation: bj-step-fade .5s cubic-bezier(.16,1,.3,1) both;
        }
        @keyframes bj-step-fade {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .bj-step-card::before {
          content: ''; position: absolute; top: -80px; right: -80px;
          width: clamp(150px, 25vw, 240px); height: clamp(150px, 25vw, 240px);
          border-radius: 50%; filter: blur(60px);
          background: linear-gradient(135deg, rgba(196,181,253,.35), rgba(253,164,175,.35));
          pointer-events: none;
        }
        .bj-step-inner { position: relative; }
        .bj-footer-note {
          text-align: center; font-size: 12px; color: #9ca3af;
          margin-top: var(--gap); padding: 0 8px;
        }

        @media (prefers-reduced-motion: reduce) {
          .bj-step-info-num, .bj-step-node.bj-active .bj-step-num,
          .bj-stepper-dot.bj-active .bj-stepper-circle,
          .bj-brand-initial, .bj-step-card {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

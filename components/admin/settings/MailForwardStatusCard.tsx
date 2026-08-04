"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { sendMailNotifyTest } from "@/app/actions/admin/mail-notify";
import type { MailForwardStatus } from "@/lib/mail-notify-constants";

interface Props {
  status: MailForwardStatus;
}

export default function MailForwardStatusCard({ status }: Props) {
  const [isTestPending, startTest] = useTransition();
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );

  function handleTest() {
    setMessage(null);
    startTest(async () => {
      const res = await sendMailNotifyTest();
      if (res.success) {
        setMessage({
          type: "success",
          text: `Mail de test envoyé à ${status.personalEmail}. Il devrait arriver dans quelques secondes.`,
        });
      } else {
        setMessage({ type: "error", text: res.error || "Envoi impossible." });
      }
    });
  }

  if (!status.personalEmail) {
    return (
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
        Aucune adresse perso vérifiée. Configurez-la dans la carte «&nbsp;Adresse e-mail où
        recevoir&nbsp;» en haut de cette page pour activer le transfert.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-bg-secondary border border-border p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm min-w-0">
            <span className="text-text-muted">De</span>
            <span className="font-semibold text-text-primary ml-1 break-all">
              {status.proEmail || "(SMTP non configuré)"}
            </span>
          </div>
          <svg
            className="w-4 h-4 text-text-muted shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
          <div className="text-sm min-w-0">
            <span className="text-text-muted">Vers</span>
            <span className="font-semibold text-text-primary ml-1 break-all">
              {status.personalEmail}
            </span>
          </div>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ring-1 ${
              status.canForward
                ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                : "bg-amber-100 text-amber-800 ring-amber-200"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status.canForward ? "bg-emerald-600 animate-pulse" : "bg-amber-600"
              }`}
            />
            {status.canForward ? "Actif" : "En pause"}
          </span>
        </div>
        {!status.canForward && (
          <p className="mt-2 text-xs text-amber-800">
            Le SMTP de la boîte pro n'est pas complètement configuré. Vérifiez la configuration
            depuis l'onboarding (adresse pro).
          </p>
        )}
      </div>

      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-body ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={isTestPending || !status.canForward}
          className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-bg-primary text-text-primary font-medium text-sm px-3.5 py-2 hover:bg-bg-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.6}
              d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"
            />
          </svg>
          {isTestPending ? "Envoi…" : "Envoyer un test"}
        </button>
        <Link
          href="/admin/bienvenue/email"
          className="inline-flex items-center gap-2 rounded-lg text-text-muted hover:text-text-primary text-sm px-3.5 py-2 hover:bg-bg-secondary transition-colors"
        >
          Changer l'adresse perso
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </Link>
      </div>
    </div>
  );
}

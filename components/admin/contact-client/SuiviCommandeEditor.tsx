"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/components/ui/Toast";
import { setOrderFollowupReviewEnabled } from "@/app/actions/admin/order-followup-review";
import TransactionalEmailModal from "@/components/admin/transactional-emails/TransactionalEmailModal";

interface Props {
  initialEnabled: boolean;
  delayDays: number;
}

export default function SuiviCommandeEditor({ initialEnabled, delayDays }: Props) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [editing, setEditing] = useState(false);

  function toggleAutomation() {
    const next = !enabled;
    startTransition(async () => {
      try {
        await setOrderFollowupReviewEnabled(next);
        setEnabled(next);
        toast.success(
          next ? "Relances activées" : "Relances désactivées",
          next
            ? `Chaque commande expédiée recevra un mail de suivi ${delayDays} jours après l'expédition.`
            : "Plus aucun mail de suivi ne partira automatiquement.",
        );
      } catch (err) {
        toast.error(
          "Activation impossible",
          err instanceof Error ? err.message : String(err),
        );
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* ─── Toggle d'activation ─── */}
      <div className="bg-bg-primary rounded-2xl border border-border shadow-sm p-5">
        <div className="flex items-start gap-4">
          <button
            type="button"
            onClick={toggleAutomation}
            disabled={pending}
            role="switch"
            aria-checked={enabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-text-primary disabled:opacity-40 disabled:cursor-not-allowed ${
              enabled ? "bg-emerald-600" : "bg-bg-tertiary border border-border-strong"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                enabled ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-body font-semibold text-text-primary">
              {enabled ? "Relance activée" : "Relance désactivée"}
            </p>
            <p className="text-xs font-body text-text-muted mt-1 leading-relaxed">
              Quand c&apos;est activé, dès qu&apos;une commande passe au
              statut <strong>« Expédiée »</strong>, un chronomètre de{" "}
              <strong>{delayDays} jours</strong> démarre. Au bout du délai, le
              client reçoit le mail de suivi ci-dessous. Un seul envoi par
              commande — pas de doublon possible.
            </p>
          </div>
        </div>
      </div>

      {/* ─── Carte « Modifier le modèle » ─── */}
      <div className="bg-bg-primary rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="font-heading text-sm font-bold text-text-primary">
            Modèle du mail
          </h2>
          <p className="text-xs font-body text-text-muted mt-0.5">
            Personnalisez le sujet et le contenu. Ajoutez un lien vers Google
            My Business, Trustpilot, ou simplement une invitation à répondre.
          </p>
        </div>
        <div className="p-5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-teal-600 to-teal-700 text-white text-sm font-body font-bold shadow-sm hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            Modifier le modèle de mail
          </button>
          <p className="text-[11px] font-body text-text-muted mt-3">
            Variables disponibles : <code className="px-1 bg-bg-secondary rounded">{`{firstName}`}</code>, <code className="px-1 bg-bg-secondary rounded">{`{orderNumber}`}</code>, <code className="px-1 bg-bg-secondary rounded">{`{orderUrl}`}</code>, <code className="px-1 bg-bg-secondary rounded">{`{reviewUrl}`}</code>, <code className="px-1 bg-bg-secondary rounded">{`{shopName}`}</code>, etc.
          </p>
        </div>
      </div>

      {editing && (
        <TransactionalEmailModal
          scenarioKey="ORDER_FOLLOWUP_REVIEW"
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

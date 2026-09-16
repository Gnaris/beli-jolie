"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBankTransferConfig } from "@/app/actions/admin/bank-transfer";
import { useToast } from "@/components/ui/Toast";
import { formatIbanForDisplay, isPlausibleIban } from "@/lib/iban-format";

type Props = {
  initialEnabled: boolean;
  initialHolder: string;
  initialIban: string; // déjà déchiffré côté serveur
};

export default function BankTransferSettingsForm({
  initialEnabled,
  initialHolder,
  initialIban,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(initialEnabled);
  const [holder, setHolder] = useState(initialHolder);
  const [iban, setIban] = useState(formatIbanForDisplay(initialIban));

  const trimmedHolder = holder.trim();
  const cleanedIban = iban.replace(/\s+/g, "").toUpperCase();
  const ibanValid = cleanedIban.length === 0 || isPlausibleIban(cleanedIban);

  const canSaveEnabled = !enabled || (trimmedHolder.length > 0 && cleanedIban.length > 0 && ibanValid);

  const handleSave = () => {
    if (enabled && !trimmedHolder) {
      toast.warning("Titulaire manquant", "Renseignez le titulaire du compte avant d'activer.");
      return;
    }
    if (enabled && !cleanedIban) {
      toast.warning("IBAN manquant", "Renseignez l'IBAN avant d'activer.");
      return;
    }
    if (enabled && !ibanValid) {
      toast.error("IBAN invalide", "Le format ne semble pas correct. Vérifiez la saisie.");
      return;
    }
    startTransition(async () => {
      const res = await setBankTransferConfig({
        enabled,
        holder: trimmedHolder,
        iban: cleanedIban,
      });
      if (!res.success) {
        toast.error("Erreur", res.error ?? "Impossible d'enregistrer.");
        return;
      }
      // Reformater visuellement l'IBAN après sauvegarde.
      if (cleanedIban) setIban(formatIbanForDisplay(cleanedIban));
      toast.success(
        "Enregistré",
        enabled
          ? "Les clientes verront le virement bancaire comme option de paiement."
          : "Le virement bancaire est désactivé.",
      );
      router.refresh();
    });
  };

  const input =
    "w-full rounded-xl border border-border bg-white px-4 py-2.5 text-[15px] focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";
  const label = "text-sm font-medium text-text-primary mb-1.5 block";

  return (
    <div className="space-y-5">
      {/* Toggle activation */}
      <div className="flex items-start justify-between gap-4 p-4 rounded-xl border border-border bg-bg-secondary/50">
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">
            Proposer le virement bancaire au checkout
          </p>
          <p className="text-xs text-text-secondary mt-1">
            Une fois activé, vos clientes verront le virement comme alternative à la carte.
            L'IBAN est chiffré en base et n'apparaît qu'après confirmation de la commande.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
            enabled ? "bg-emerald-500" : "bg-zinc-300"
          }`}
          aria-pressed={enabled}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Titulaire */}
      <div>
        <label className={label}>
          Titulaire du compte <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={holder}
          onChange={(e) => setHolder(e.target.value)}
          placeholder="Ex. BELI & JOLIE SAS"
          className={input}
        />
        <p className="text-xs text-text-secondary/70 mt-1.5">
          Nom exact du compte tel qu'il figure sur votre RIB.
        </p>
      </div>

      {/* IBAN */}
      <div>
        <label className={label}>
          IBAN <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={iban}
          onChange={(e) => setIban(e.target.value.toUpperCase())}
          placeholder="FR76 3000 4028 3700 0123 4567 890"
          autoComplete="off"
          className={`${input} font-mono tracking-wider ${
            iban && !ibanValid ? "border-rose-400 focus:border-rose-500" : ""
          }`}
        />
        {iban && !ibanValid && (
          <p className="text-xs text-rose-600 mt-1.5">
            Format d'IBAN invalide — vérifiez la saisie.
          </p>
        )}
        {iban && ibanValid && (
          <p className="text-xs text-emerald-700 mt-1.5">
            ✓ Format reconnu — sera chiffré en base à l'enregistrement.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || !canSaveEnabled}
          className="px-6 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

"use client";

/**
 * SageArticleCodeMappingModal — code article Sage pour la facturation.
 * Utilisé par l'extension « Regroupement facture » qui l'envoie à SageBridge
 * pour la création de factures provisoires dans Sage 50.
 *
 * Même pattern que FaireCategoryMappingModal, mais le champ est une simple
 * chaîne libre (ex. "ART0003") — le format dépend du dossier Sage du tenant.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import { useToast } from "@/components/ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  currentValue: string | null;
  onSave: (next: string | null) => Promise<unknown>;
}

export default function SageArticleCodeMappingModal({
  open,
  onClose,
  entityLabel,
  currentValue,
  onSave,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(currentValue ?? "");
    setError(null);
    setSaving(false);
  }, [open, currentValue]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const next = value.trim() || null;
      await onSave(next);
      toast.success(next ? "Code article Sage enregistré" : "Code article Sage retiré");
      router.refresh();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur d'enregistrement.";
      setError(msg);
      toast.error("Sage", msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · ${entityLabel}`}
      title="Sage — code article de facturation"
      subtitle="Code utilisé par l'extension « Regroupement facture » pour créer les factures dans Sage 50 via SageBridge."
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#10B981,#059669)" text="Sa" />}
      accentColor="#10B981"
      maxWidth="md"
      error={error}
      primaryAction={{ label: "Enregistrer", onClick: handleSave, loading: saving }}
    >
      <div className="flex flex-col gap-3">
        <label className="block text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
          Code article dans ton dossier Sage
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex : ART0003"
          autoFocus
          maxLength={50}
          className="field-input w-full text-sm font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !saving) {
              e.preventDefault();
              handleSave();
            }
          }}
        />
        <p className="text-[11.5px] text-text-muted leading-relaxed">
          Ce code doit exister à l'identique dans ton dossier Sage 50 (sinon
          Sage refuse la ligne lors de la création de la facture). Laisse vide
          pour que l'extension te demande à chaque fois.
        </p>
      </div>
    </MappingModalShell>
  );
}

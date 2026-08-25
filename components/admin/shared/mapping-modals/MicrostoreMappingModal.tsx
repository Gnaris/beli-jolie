"use client";

/**
 * MicrostoreMappingModal — mini-modal générique pour mapper une entité BJ
 * (catégorie, couleur, saison, composition) vers son équivalent Microstore.
 *
 * Wrappe `MicrostoreAttributeSelect` (chargement des attributs Microstore côté
 * client) + persistance via une action fournie par le parent (chaque entité
 * a sa propre server action : updateCategoryMicrostoreMapping, etc.).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import { MicrostoreAttributeSelect } from "@/components/admin/shared/MicrostoreAttributeSelect";
import type { MicrostoreAttrType } from "@/lib/microstore-attributes";
import { useToast } from "@/components/ui/Toast";

type Kind = MicrostoreAttrType | "color";

interface Props {
  open: boolean;
  onClose: () => void;
  entityLabel: string; // ex: "Catégorie « Bague »"
  kind: Kind;
  currentValue: number | null;
  /** Server action qui persiste le mapping. Reçoit le nouvel ID (ou null). */
  onSave: (next: number | null) => Promise<void>;
}

export default function MicrostoreMappingModal({
  open,
  onClose,
  entityLabel,
  kind,
  currentValue,
  onSave,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState<number | null>(currentValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(currentValue);
    setError(null);
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave(value);
      toast.success(value != null ? "Correspondance Microstore enregistrée" : "Lien Microstore retiré");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · ${entityLabel}`}
      title="Microstore"
      subtitle="Choisis l'équivalent dans la bibliothèque Microstore."
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#0891b2,#22d3ee)" text="M" />}
      accentColor="#0891b2"
      maxWidth="lg"
      error={error}
      primaryAction={{
        label: "Enregistrer",
        onClick: handleSave,
        loading: saving,
      }}
    >
      <MicrostoreAttributeSelect
        kind={kind}
        value={value}
        onChange={setValue}
      />
    </MappingModalShell>
  );
}

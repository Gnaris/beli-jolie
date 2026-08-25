"use client";

/**
 * EfashionMappingModal — mini-modal générique pour mapper une entité BJ
 * (catégorie, couleur, saison, composition) vers son équivalent eFashion.
 *
 * Wrappe simplement `EfashionMappingPicker` en mode auto-save (kind + entityId).
 * L'auto-save appelle déjà la bonne server action côté client — le modal
 * n'a plus qu'à fournir la coque + un bouton « Fermer ».
 */

import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import EfashionMappingPicker, {
  type EmbeddedPickerKind,
} from "@/components/admin/EfashionMappingPicker";

interface Props {
  open: boolean;
  onClose: () => void;
  entityId: string;
  entityName: string;
  entityLabel: string; // ex: "Catégorie « Bague »"
  kind: EmbeddedPickerKind;
  currentValue: number | null;
}

export default function EfashionMappingModal({
  open,
  onClose,
  entityId,
  entityName,
  entityLabel,
  kind,
  currentValue,
}: Props) {
  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · ${entityLabel}`}
      title="eFashion Paris"
      subtitle="La correspondance est enregistrée automatiquement à chaque changement."
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#7C3AED,#A855F7)" text="eF" />}
      accentColor="#7C3AED"
      maxWidth="xl"
    >
      <EfashionMappingPicker
        entityId={entityId}
        kind={kind}
        initialValue={currentValue}
        entityName={entityName}
      />
    </MappingModalShell>
  );
}

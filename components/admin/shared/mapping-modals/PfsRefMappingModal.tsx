"use client";

/**
 * PfsRefMappingModal — mini-modal générique pour mapper une entité BJ
 * (couleur / composition / saison) vers sa référence PFS (simple ref string,
 * pas de cascade comme pour les catégories).
 *
 * Charge les options PFS live (fetchPfsMappingOptions ou fetchPfsColorOptions
 * selon l'entityType) puis délègue la persistance au parent via `onSave`. Le
 * parent appelle l'action serveur qui va bien (updateColorPfsRef,
 * updateCompositionPfsRef, updateSeasonPfsRef) et retourne l'impact
 * éventuel — le modal l'ouvre via useMappingImpact.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import PfsSuggestions, { type PfsRefOption } from "@/components/admin/pfs/PfsSuggestions";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { fetchPfsColorOptions } from "@/app/actions/admin/colors";
import { PFS_COLORS, PFS_COMPOSITIONS } from "@/lib/marketplace-excel/pfs-taxonomy";
import { useMappingImpact } from "@/components/admin/mapping/MappingImpactContext";
import { useToast } from "@/components/ui/Toast";
import type { MappingChangeSummary } from "@/lib/mapping-impact";

type PfsRefEntity = "color" | "composition" | "season";

interface Props {
  open: boolean;
  onClose: () => void;
  entityType: PfsRefEntity;
  entityName: string;
  entityLabel: string; // ex: "Couleur « Or »"
  currentRef: string | null;
  /** Retourne l'impact éventuel — le modal l'affichera si non-null. */
  onSave: (nextRef: string | null) => Promise<{ impact?: MappingChangeSummary | null }>;
}

const ENTITY_TITLES: Record<PfsRefEntity, { eyebrow: (name: string) => string; helper: string }> = {
  color: {
    eyebrow: (name) => `Mapping · Couleur « ${name} »`,
    helper: "Choisis la référence couleur PFS équivalente.",
  },
  composition: {
    eyebrow: (name) => `Mapping · Composition « ${name} »`,
    helper: "Choisis la référence composition PFS équivalente.",
  },
  season: {
    eyebrow: (name) => `Mapping · Saison « ${name} »`,
    helper: "Choisis la référence saison PFS équivalente.",
  },
};

export default function PfsRefMappingModal({
  open,
  onClose,
  entityType,
  entityName,
  entityLabel,
  currentRef,
  onSave,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { showMappingImpact } = useMappingImpact();

  const [pfsRef, setPfsRef] = useState<string | null>(currentRef);
  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);
  const [pfsColorOptions, setPfsColorOptions] = useState<PfsRefOption[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset à chaque ouverture (dépend uniquement de open pour éviter les
  // resets sauvages à mid-flight).
  useEffect(() => {
    if (!open) return;
    setPfsRef(currentRef);
    setError(null);
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Charge les annexes PFS live pour composition/season (fallback statique)
  useEffect(() => {
    if (!open) return;
    if (entityType === "color") return;
    if (pfsAnnexes) return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => { if (!cancelled) setPfsAnnexes(res); })
      .catch(() => { /* silent, fallback taxonomie statique */ });
    return () => { cancelled = true; };
  }, [open, entityType, pfsAnnexes]);

  // Charge les couleurs PFS live (fallback PFS_COLORS statique)
  useEffect(() => {
    if (!open) return;
    if (entityType !== "color") return;
    if (pfsColorOptions) return;
    let cancelled = false;
    fetchPfsColorOptions()
      .then((res) => {
        if (cancelled) return;
        setPfsColorOptions(res.map((c) => ({ value: c.value, label: c.label })));
      })
      .catch(() => { /* silent, fallback statique */ });
    return () => { cancelled = true; };
  }, [open, entityType, pfsColorOptions]);

  const suggestionOptions = useMemo<PfsRefOption[]>(() => {
    if (entityType === "color") {
      return pfsColorOptions && pfsColorOptions.length > 0 ? pfsColorOptions : PFS_COLORS;
    }
    if (entityType === "composition") {
      return pfsAnnexes && pfsAnnexes.compositions.length > 0
        ? pfsAnnexes.compositions
        : PFS_COMPOSITIONS;
    }
    // season
    return pfsAnnexes?.seasons ?? [];
  }, [entityType, pfsAnnexes, pfsColorOptions]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await onSave(pfsRef);
      if (res.impact) showMappingImpact(res.impact);
      toast.success("Mapping PFS enregistré");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur d'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  const titleCfg = ENTITY_TITLES[entityType];

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={titleCfg.eyebrow(entityName)}
      title="Paris Fashion Shop"
      subtitle={titleCfg.helper}
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#0F172A,#334155)" text="PFS" />}
      accentColor="#334155"
      maxWidth="xl"
      error={error}
      primaryAction={{
        label: "Enregistrer",
        onClick: handleSave,
        loading: saving,
      }}
    >
      <div className="space-y-5">
        <MarketplaceMappingSection
          entityType={entityType}
          pfsRef={pfsRef}
          onPfsRefChange={setPfsRef}
        />
        <div className="pt-3 border-t border-border">
          <PfsSuggestions
            mode="ref"
            query={entityName}
            options={suggestionOptions}
            currentValue={pfsRef}
            onPick={(ref) => setPfsRef(ref)}
            label="Correspondance PFS suggérée"
          />
        </div>
      </div>
    </MappingModalShell>
  );
}

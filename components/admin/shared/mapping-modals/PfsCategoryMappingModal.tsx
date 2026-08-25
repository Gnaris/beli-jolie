"use client";

/**
 * PfsCategoryMappingModal — mini-modal dédié au mapping PFS d'une catégorie.
 * Ouvert depuis la carte « PFS » de la fiche catégorie.
 *
 * Cascade Genre → Famille → Catégorie PFS + suggestions live d'après le nom FR
 * de la catégorie. Persistance via `updateCategoryPfsTaxonomy` (impact mapping
 * remonté à la modale globale si des produits sont publiés).
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import MarketplaceMappingSection from "@/components/admin/MarketplaceMappingSection";
import PfsSuggestions, { type PfsCategoryTriple } from "@/components/admin/pfs/PfsSuggestions";
import { fetchPfsMappingOptions, type PfsMappingOptions } from "@/app/actions/admin/pfs-annexes";
import { updateCategoryPfsTaxonomy } from "@/app/actions/admin/categories";
import {
  PFS_GENDER_LABELS,
  PFS_FAMILIES_BY_GENDER,
  PFS_SUBCATEGORIES_BY_FAMILY,
} from "@/lib/marketplace-excel/pfs-taxonomy";
import { useMappingImpact } from "@/components/admin/mapping/MappingImpactContext";
import { useToast } from "@/components/ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  categoryId: string;
  categoryName: string;
  currentGender: string | null;
  currentFamilyName: string | null;
  currentCategoryName: string | null;
}

export default function PfsCategoryMappingModal({
  open,
  onClose,
  categoryId,
  categoryName,
  currentGender,
  currentFamilyName,
  currentCategoryName,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { showMappingImpact } = useMappingImpact();

  const [pfsGender, setPfsGender] = useState<string | null>(currentGender);
  const [pfsFamilyName, setPfsFamilyName] = useState<string | null>(currentFamilyName);
  const [pfsCategoryName, setPfsCategoryName] = useState<string | null>(currentCategoryName);
  const [pfsAnnexes, setPfsAnnexes] = useState<PfsMappingOptions | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset à chaque ouverture (ne dépend que du flag open)
  useEffect(() => {
    if (!open) return;
    setPfsGender(currentGender);
    setPfsFamilyName(currentFamilyName);
    setPfsCategoryName(currentCategoryName);
    setError(null);
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Charge les annexes PFS pour PfsSuggestions (fallback taxonomie statique)
  useEffect(() => {
    if (!open || pfsAnnexes) return;
    let cancelled = false;
    fetchPfsMappingOptions()
      .then((res) => { if (!cancelled) setPfsAnnexes(res); })
      .catch(() => { /* silent, on fallback statique */ });
    return () => { cancelled = true; };
  }, [open, pfsAnnexes]);

  const pfsCategoryTriples = useMemo<PfsCategoryTriple[]>(() => {
    if (pfsAnnexes && pfsAnnexes.categories.length > 0) {
      return pfsAnnexes.categories.map((c) => ({
        gender: PFS_GENDER_LABELS[c.gender] ?? c.gender,
        family: c.family,
        category: c.category,
      }));
    }
    const out: PfsCategoryTriple[] = [];
    for (const [gender, families] of Object.entries(PFS_FAMILIES_BY_GENDER)) {
      for (const family of families) {
        const cats = PFS_SUBCATEGORIES_BY_FAMILY[family] ?? [];
        for (const category of cats) {
          out.push({ gender, family, category });
        }
      }
    }
    return out;
  }, [pfsAnnexes]);

  const currentCategoryTriple = useMemo<PfsCategoryTriple | null>(() => {
    if (!pfsGender || !pfsFamilyName || !pfsCategoryName) return null;
    const genderLabel = PFS_GENDER_LABELS[pfsGender];
    if (!genderLabel) return null;
    return { gender: genderLabel, family: pfsFamilyName, category: pfsCategoryName };
  }, [pfsGender, pfsFamilyName, pfsCategoryName]);

  function applyCategoryTriple(t: PfsCategoryTriple) {
    const codeEntry = Object.entries(PFS_GENDER_LABELS).find(([, label]) => label === t.gender);
    const genderCode = codeEntry ? codeEntry[0] : null;
    setPfsGender(genderCode);
    setPfsFamilyName(t.family);
    setPfsCategoryName(t.category);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await updateCategoryPfsTaxonomy(categoryId, pfsGender, pfsFamilyName, pfsCategoryName);
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

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · Catégorie « ${categoryName} »`}
      title="Paris Fashion Shop"
      subtitle="Choisis le genre, la famille et la catégorie PFS équivalentes."
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
          entityType="category"
          pfsGender={pfsGender}
          pfsFamilyName={pfsFamilyName}
          pfsCategoryName={pfsCategoryName}
          onPfsGenderChange={setPfsGender}
          onPfsFamilyNameChange={setPfsFamilyName}
          onPfsCategoryNameChange={setPfsCategoryName}
        />
        <div className="pt-3 border-t border-border">
          <PfsSuggestions
            mode="category"
            query={categoryName}
            triples={pfsCategoryTriples}
            currentValue={currentCategoryTriple}
            onPickCategory={applyCategoryTriple}
            label="Correspondance PFS suggérée"
          />
        </div>
      </div>
    </MappingModalShell>
  );
}

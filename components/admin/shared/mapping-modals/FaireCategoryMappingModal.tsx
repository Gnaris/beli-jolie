"use client";

/**
 * FaireCategoryMappingModal — mini-modal dédié au mapping Faire d'une catégorie.
 * Wrappe `FaireTaxonomySelect` : la recherche + les raccourcis d'après le nom
 * FR y sont déjà intégrés. Le save auto-appelle updateCategoryFaireTaxonomy.
 */

import { useRouter } from "next/navigation";
import MappingModalShell, { AvatarBadge } from "./MappingModalShell";
import FaireTaxonomySelect from "@/components/admin/FaireTaxonomySelect";
import { updateCategoryFaireTaxonomy } from "@/app/actions/admin/categories";
import { useMappingImpact } from "@/components/admin/mapping/MappingImpactContext";
import { useToast } from "@/components/ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  categoryId: string;
  categoryName: string;
  currentTaxonomyId: string | null;
}

export default function FaireCategoryMappingModal({
  open,
  onClose,
  categoryId,
  categoryName,
  currentTaxonomyId,
}: Props) {
  const router = useRouter();
  const toast = useToast();
  const { showMappingImpact } = useMappingImpact();

  return (
    <MappingModalShell
      open={open}
      onClose={onClose}
      eyebrow={`Mapping · Catégorie « ${categoryName} »`}
      title="Faire"
      subtitle="Choisis le type de produit Faire équivalent. La sauvegarde est automatique."
      avatar={<AvatarBadge gradient="linear-gradient(135deg,#F59E0B,#F97316)" text="Fr" />}
      accentColor="#F59E0B"
      maxWidth="xl"
    >
      <FaireTaxonomySelect
        label="Type de produit Faire"
        value={currentTaxonomyId}
        helpText="Recherche par nom (« bracelet », « bague »…). Le fil d'Ariane aide à distinguer les doublons."
        suggestionQuery={categoryName}
        onSave={async (next) => {
          try {
            const res = await updateCategoryFaireTaxonomy(categoryId, next);
            if (res.impact) showMappingImpact(res.impact);
            toast.success(next ? "Catégorie Faire liée" : "Lien Faire retiré");
            router.refresh();
          } catch (err) {
            const message = err instanceof Error ? err.message : "Erreur d'enregistrement.";
            toast.error("Faire", message);
            throw err;
          }
        }}
      />
    </MappingModalShell>
  );
}

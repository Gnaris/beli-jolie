"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import { batchTranslateProducts } from "@/app/actions/admin/batch-translations";
import { useLoadingOverlay } from "@/components/ui/LoadingOverlay";
import { useToast } from "@/components/ui/Toast";
import { NON_DEFAULT_LOCALES } from "@/i18n/locales";

interface ProductItem {
  id: string;
  name: string;
  translationLocales: string[];
}

const ALL_NON_FR_LOCALES = NON_DEFAULT_LOCALES;

export default function ProductTranslateAllButton({ products }: { products: ProductItem[] }) {
  const router = useRouter();
  const { showLoading, hideLoading } = useLoadingOverlay();
  const toast = useToast();

  const items = products.map((p) => ({
    id: p.id,
    text: p.name,
    hasTranslations: ALL_NON_FR_LOCALES.every((l) => p.translationLocales.includes(l)),
  }));

  const handleTranslateAll = useCallback(async (translations: Record<string, Record<string, string>>) => {
    const batch = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    if (batch.length === 0) return;
    showLoading("Sauvegarde des traductions…");
    try {
      await batchTranslateProducts(batch);
      toast.success("Traductions sauvegardées", `${batch.length} produit${batch.length > 1 ? "s" : ""} traduit${batch.length > 1 ? "s" : ""}`);
      router.refresh();
    } catch {
      toast.error("Erreur", "Erreur lors de la sauvegarde des traductions");
    } finally {
      hideLoading();
    }
  }, [showLoading, hideLoading, router, toast]);

  return (
    <TranslateAllButton
      items={items}
      onTranslated={handleTranslateAll}
      label="Tout traduire"
      onlyMissing
    />
  );
}

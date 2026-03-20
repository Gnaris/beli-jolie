"use client";

import { useRouter } from "next/navigation";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import TranslateAllButton from "@/components/admin/TranslateAllButton";

interface CollectionInfo {
  id: string;
  name: string;
  hasTranslations: boolean;
}

export default function CollectionsTranslateAll({ collections }: { collections: CollectionInfo[] }) {
  const router = useRouter();

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    const items = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
    await batchUpdateTranslations("collection", items);
    router.refresh();
  }

  return (
    <TranslateAllButton
      items={collections.map((c) => ({
        id: c.id,
        text: c.name,
        hasTranslations: c.hasTranslations,
      }))}
      onTranslated={handleTranslateAll}
      label="Tout traduire"
      onlyMissing
    />
  );
}

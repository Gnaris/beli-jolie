"use client";

import TranslateAllButton from "@/components/admin/TranslateAllButton";

interface CollectionInfo {
  id: string;
  name: string;
  hasTranslations: boolean;
}

export default function CollectionsTranslateAll({ collections }: { collections: CollectionInfo[] }) {
  return (
    <TranslateAllButton
      entityType="collection"
      section="Collections"
      items={collections.map((c) => ({
        id: c.id,
        text: c.name,
        hasTranslations: c.hasTranslations,
      }))}
      onlyMissing
    />
  );
}

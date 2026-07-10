"use client";

import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateCompositionTrigger from "./CreateCompositionTrigger";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function CompositionsHeaderActions({ items }: Props) {
  return (
    <div className="flex gap-2 items-center">
      <TranslateAllButton
        entityType="composition"
        section="Compositions"
        items={items}
        onlyMissing
      />
      <CreateCompositionTrigger />
    </div>
  );
}

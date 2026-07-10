"use client";

import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateColorTrigger from "./CreateColorTrigger";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function ColorsHeaderActions({ items }: Props) {
  return (
    <div className="flex gap-2 items-center">
      <TranslateAllButton
        entityType="color"
        section="Couleurs"
        items={items}
        onlyMissing
      />
      <CreateColorTrigger />
    </div>
  );
}

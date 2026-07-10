"use client";

import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateSeasonTrigger from "./CreateSeasonTrigger";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function SeasonsHeaderActions({ items }: Props) {
  return (
    <div className="flex gap-2 items-center">
      <TranslateAllButton
        entityType="season"
        section="Saisons"
        items={items}
        onlyMissing
      />
      <CreateSeasonTrigger />
    </div>
  );
}

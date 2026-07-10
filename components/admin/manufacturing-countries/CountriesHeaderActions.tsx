"use client";

import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateCountryTrigger from "./CreateCountryTrigger";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function CountriesHeaderActions({ items }: Props) {
  return (
    <div className="flex gap-2 items-center">
      <TranslateAllButton
        entityType="manufacturing-country"
        section="Pays de fabrication"
        items={items}
        onlyMissing
      />
      <CreateCountryTrigger />
    </div>
  );
}

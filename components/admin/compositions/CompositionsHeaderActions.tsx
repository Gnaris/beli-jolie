"use client";

import { useRouter } from "next/navigation";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateCompositionTrigger from "./CreateCompositionTrigger";
import { useToast } from "@/components/ui/Toast";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function CompositionsHeaderActions({ items }: Props) {
  const router = useRouter();
  const toast = useToast();

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    try {
      const compItems = Object.entries(translations).map(([id, t]) => ({ id, translations: t }));
      if (compItems.length > 0) {
        await batchUpdateTranslations("composition", compItems);
      }
      router.refresh();
      toast.success("Traductions enregistrées");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de l'enregistrement.";
      toast.error("Traduction", message);
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <TranslateAllButton
        items={items}
        onTranslated={handleTranslateAll}
        label="Tout traduire"
        onlyMissing
      />
      <CreateCompositionTrigger />
    </div>
  );
}

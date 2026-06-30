"use client";

import { useRouter } from "next/navigation";
import { batchUpdateTranslations } from "@/app/actions/admin/batch-translations";
import TranslateAllButton from "@/components/admin/TranslateAllButton";
import CreateCategoryTrigger from "@/components/admin/categories/CreateCategoryTrigger";
import { useToast } from "@/components/ui/Toast";

interface TranslateItem {
  id: string;
  text: string;
  hasTranslations: boolean;
}

interface Props {
  items: TranslateItem[];
}

export default function CategoriesHeaderActions({ items }: Props) {
  const router = useRouter();
  const toast = useToast();

  async function handleTranslateAll(translations: Record<string, Record<string, string>>) {
    try {
      const catItems: { id: string; translations: Record<string, string> }[] = [];
      const subItems: { id: string; translations: Record<string, string> }[] = [];

      for (const [key, t] of Object.entries(translations)) {
        if (key.startsWith("cat:")) {
          catItems.push({ id: key.slice(4), translations: t });
        } else if (key.startsWith("sub:")) {
          subItems.push({ id: key.slice(4), translations: t });
        }
      }

      const promises: Promise<unknown>[] = [];
      if (catItems.length > 0) promises.push(batchUpdateTranslations("category", catItems));
      if (subItems.length > 0) promises.push(batchUpdateTranslations("subcategory", subItems));
      await Promise.all(promises);
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
      <CreateCategoryTrigger />
    </div>
  );
}

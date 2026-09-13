import type { CategorySeoFaqItem } from "@/lib/category-seo";

interface Props {
  items: CategorySeoFaqItem[];
}

/**
 * FAQ dépliable rendue côté serveur avec `<details>` natif — accessible sans JS
 * et déjà indexée par Google (le FAQPage JSON-LD est ajouté à part).
 */
export default function CategoryFaq({ items }: Props) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <details
          key={i}
          className="group rounded-2xl border border-border bg-bg-primary p-5 open:shadow-sm transition-shadow"
        >
          <summary className="cursor-pointer flex items-center justify-between font-medium text-text-primary font-body list-none">
            <span>{item.q}</span>
            <span
              className="text-text-muted transition-transform group-open:rotate-180 ml-4 flex-shrink-0"
              aria-hidden="true"
            >
              ▾
            </span>
          </summary>
          <div className="mt-3 text-sm text-text-secondary leading-relaxed font-body whitespace-pre-line">
            {item.a}
          </div>
        </details>
      ))}
    </div>
  );
}

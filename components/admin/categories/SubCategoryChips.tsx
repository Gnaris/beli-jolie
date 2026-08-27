"use client";

type Sub = {
  id: string;
  name: string;
  translations: Record<string, string>;
  orderchampCategoryPath?: string | null;
  orderchampLabel?: string | null;
  microstoreCategoryId?: number | null;
  microstoreLabel?: string | null;
};

type Props = {
  subs: Sub[];
  onAdd: () => void;
  onEdit: (sub: Sub) => void;
  onDelete: (sub: Sub) => void;
  onOrderchamp?: (sub: Sub) => void;
  onMicrostore?: (sub: Sub) => void;
};

export default function SubCategoryChips({ subs, onAdd, onEdit, onDelete, onOrderchamp, onMicrostore }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {subs.map((s) => {
        const translated = !!(s.translations.fr && s.translations.fr.trim() && s.translations.en && s.translations.en.trim());
        const ocMapped = !!s.orderchampCategoryPath;
        const msMapped = s.microstoreCategoryId != null;
        return (
          <div
            key={s.id}
            data-sub-id={s.id}
            className="relative inline-flex items-center gap-2 pl-3.5 pr-2 py-2 rounded-xl bg-bg-secondary border border-border shadow-[var(--shadow-sm)] hover:border-border-strong transition-colors"
          >
            <button
              type="button"
              onClick={() => onEdit(s)}
              className="text-[12.5px] font-medium text-text-primary"
            >
              {s.name}
            </button>
            {onOrderchamp && (
              <button
                type="button"
                onClick={() => onOrderchamp(s)}
                title={
                  ocMapped
                    ? `Orderchamp : ${s.orderchampLabel ?? s.orderchampCategoryPath}`
                    : "Orderchamp : mapping facultatif — hérité de la catégorie parente"
                }
                aria-label={ocMapped ? "Modifier le mapping Orderchamp" : "Ajouter un mapping Orderchamp"}
                className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-md text-[9px] font-bold shrink-0 transition-colors ${
                  ocMapped
                    ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                    : "bg-bg-primary border border-dashed border-border text-text-muted hover:text-orange-600 hover:border-orange-300"
                }`}
              >
                O
              </button>
            )}
            {onMicrostore && (
              <button
                type="button"
                onClick={() => onMicrostore(s)}
                title={
                  msMapped
                    ? `Microstore : ${s.microstoreLabel ?? `#${s.microstoreCategoryId}`}`
                    : "Microstore : à mapper pour pouvoir choisir cette sous-catégorie comme étiquette Microstore d'un produit"
                }
                aria-label={msMapped ? "Modifier le mapping Microstore" : "Ajouter un mapping Microstore"}
                className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-md text-[9px] font-bold shrink-0 transition-colors ${
                  msMapped
                    ? "bg-cyan-100 text-cyan-700 hover:bg-cyan-200"
                    : "bg-bg-primary border border-dashed border-border text-text-muted hover:text-cyan-600 hover:border-cyan-300"
                }`}
              >
                M
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(s)}
              aria-label={`Supprimer ${s.name}`}
              className="text-[15px] leading-none text-text-muted hover:text-[#DC2626] transition-colors"
            >
              ×
            </button>
            <span
              aria-hidden="true"
              data-translated={translated}
              className={`absolute -top-[3px] -right-[3px] w-[11px] h-[11px] rounded-full border-2 border-bg-primary ${
                translated ? "bg-emerald-300 shadow-[0_0_6px_rgba(110,231,183,0.55)]" : "bg-amber-300 shadow-[0_0_6px_rgba(252,211,77,0.55)]"
              }`}
            />
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-bg-primary border border-dashed border-border-dark text-[12.5px] font-medium text-text-secondary hover:text-text-primary hover:border-ink transition-colors"
      >
        + ajouter
      </button>
    </div>
  );
}

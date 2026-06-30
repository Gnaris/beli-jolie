"use client";

type Sub = { id: string; name: string; translations: Record<string, string> };

type Props = {
  subs: Sub[];
  onAdd: () => void;
  onEdit: (sub: Sub) => void;
  onDelete: (sub: Sub) => void;
};

export default function SubCategoryChips({ subs, onAdd, onEdit, onDelete }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {subs.map((s) => {
        const translated = !!(s.translations.fr && s.translations.fr.trim() && s.translations.en && s.translations.en.trim());
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

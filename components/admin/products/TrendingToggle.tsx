"use client";
import { useProductFormHeader } from "./ProductFormHeaderContext";

export function TrendingToggle() {
  const { isTrending, trendingToggle } = useProductFormHeader();
  const disabled = !trendingToggle;

  const handleClick = () => {
    if (trendingToggle) trendingToggle.toggle();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={isTrending ? "Retirer le badge Tendance" : "Marquer comme Tendance du moment"}
      className={
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-body text-[12px] font-semibold transition-all whitespace-nowrap " +
        (isTrending
          ? "bg-rose-100 border-rose-300 text-rose-900 shadow-sm"
          : "bg-bg-secondary border-border-dark text-text-primary hover:bg-bg-tertiary")
      }
    >
      <svg
        className={"w-3.5 h-3.5 " + (isTrending ? "opacity-100" : "opacity-40")}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A3 3 0 0112.12 15.12z" clipRule="evenodd" />
      </svg>
      Tendance
    </button>
  );
}

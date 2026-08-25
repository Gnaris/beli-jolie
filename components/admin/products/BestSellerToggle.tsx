"use client";
import { useProductFormHeader } from "./ProductFormHeaderContext";

export function BestSellerToggle() {
  const { isBestSeller, bestSellerToggle } = useProductFormHeader();
  const disabled = !bestSellerToggle;

  const handleClick = () => {
    if (bestSellerToggle) bestSellerToggle.toggle();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={isBestSeller ? "Retirer le badge Best-seller" : "Marquer comme Best-seller"}
      className={
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-body text-[12px] font-semibold transition-all whitespace-nowrap " +
        (isBestSeller
          ? "bg-amber-100 border-amber-300 text-amber-900 shadow-sm"
          : "bg-bg-secondary border-border-dark text-text-primary hover:bg-bg-tertiary")
      }
    >
      <svg
        className={"w-3.5 h-3.5 " + (isBestSeller ? "opacity-100" : "opacity-40")}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.956a1 1 0 00.95.69h4.161c.969 0 1.371 1.24.588 1.81l-3.366 2.446a1 1 0 00-.363 1.118l1.286 3.956c.3.922-.755 1.688-1.54 1.118l-3.366-2.446a1 1 0 00-1.176 0l-3.366 2.446c-.784.57-1.838-.196-1.539-1.118l1.286-3.956a1 1 0 00-.363-1.118L2.98 9.383c-.783-.57-.38-1.81.588-1.81h4.161a1 1 0 00.951-.69l1.286-3.956z" />
      </svg>
      Best-seller
    </button>
  );
}

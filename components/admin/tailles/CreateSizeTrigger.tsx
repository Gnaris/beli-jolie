"use client";

export default function CreateSizeTrigger() {
  return (
    <button
      type="button"
      onClick={() => document.querySelector<HTMLButtonElement>("[data-trigger-create-size]")?.click()}
      className="admin-header-cta inline-flex items-center gap-2 h-10 px-4 rounded-xl text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink/15"
    >
      <span className="text-base leading-none">+</span> Nouvelle taille
    </button>
  );
}

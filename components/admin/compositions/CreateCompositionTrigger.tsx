"use client";

export default function CreateCompositionTrigger() {
  return (
    <button
      type="button"
      onClick={() => document.querySelector<HTMLButtonElement>("[data-trigger-create-composition]")?.click()}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-b from-[#27272A] to-[#18181B] text-text-inverse text-[13px] font-semibold shadow-[var(--shadow-card)] hover:from-[#36393F] hover:to-[#202024] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ink/15"
    >
      <span className="text-base leading-none">+</span> Nouvelle composition
    </button>
  );
}

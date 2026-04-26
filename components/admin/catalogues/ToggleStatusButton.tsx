"use client";

import { useTransition } from "react";
import { updateCatalog } from "@/app/actions/admin/catalogs";

interface Props {
  id: string;
  status: "INACTIVE" | "ACTIVE";
}

export default function ToggleStatusButton({ id, status }: Props) {
  const [isPending, startTransition] = useTransition();
  const isActive = status === "ACTIVE";

  const handleToggle = () => {
    startTransition(async () => {
      await updateCatalog(id, {
        status: isActive ? "INACTIVE" : "ACTIVE",
      });
    });
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      className="inline-flex items-center gap-2.5 group disabled:opacity-50"
      title={isActive ? "Désactiver le catalogue" : "Activer le catalogue"}
    >
      {/* Switch track */}
      <span
        className={`relative inline-flex h-[22px] w-[40px] shrink-0 rounded-full transition-colors duration-200 ${
          isActive ? "bg-[#22C55E]" : "bg-[#D1D5DB]"
        }`}
      >
        {/* Switch thumb */}
        <span
          className={`inline-block h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 mt-[2px] ${
            isActive ? "translate-x-[20px]" : "translate-x-[2px]"
          }`}
        />
      </span>
      {/* Label */}
      <span
        className={`text-xs font-medium font-body transition-colors ${
          isActive ? "text-[#16A34A]" : "text-[#9CA3AF]"
        }`}
      >
        {isPending ? "…" : isActive ? "Activé" : "Désactivé"}
      </span>
    </button>
  );
}

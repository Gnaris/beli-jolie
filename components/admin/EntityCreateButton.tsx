"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QuickCreateModal, { QuickCreateType } from "@/components/admin/products/QuickCreateModal";

interface EntityCreateButtonProps {
  type: QuickCreateType;
  label?: string;
  categoryId?: string;
  className?: string;
  usedPfsRefs?: string[];
}

export default function EntityCreateButton({
  type,
  label = "Créer",
  categoryId,
  className = "btn-primary whitespace-nowrap",
  usedPfsRefs,
}: EntityCreateButtonProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <QuickCreateModal
        type={type}
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => { setOpen(false); router.refresh(); }}
        categoryId={categoryId}
        usedPfsRefs={usedPfsRefs}
      />
    </>
  );
}

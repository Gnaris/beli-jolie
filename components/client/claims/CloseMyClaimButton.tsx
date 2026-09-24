"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { closeMyClaim } from "@/app/actions/client/claims";

export default function CloseMyClaimButton({ claimId }: { claimId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { confirm } = useConfirm();
  const toast = useToast();

  async function handleClick() {
    const ok = await confirm({
      title: "Clôturer votre demande ?",
      message:
        "Vous pourrez la rouvrir à tout moment en envoyant un nouveau message dans la conversation.",
      confirmLabel: "Clôturer",
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await closeMyClaim(claimId);
      if (!res.success) {
        toast.error("Clôture impossible", res.error);
        return;
      }
      toast.success("Demande clôturée");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border bg-white text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors disabled:opacity-50"
    >
      {isPending ? "Clôture…" : "Clôturer ma demande"}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 13l4 4L19 7" />
      </svg>
    </button>
  );
}

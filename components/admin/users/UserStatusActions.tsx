"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import { reactivateInactiveClient } from "@/app/actions/admin/inactive-client-revoke";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { UserStatus } from "@prisma/client";

/**
 * Boutons Approuver / Rejeter / Révoquer / Réactiver de la fiche client admin.
 *
 * Wrap client-side pour contourner un bug Next.js 16 : quand l'action
 * `updateUserStatus` faisait `redirect()` depuis cette route dynamique
 * (`/admin/clients/[id]`), Next.js perdait le client reference
 * manifest et renvoyait une page blanche. On appelle donc l'action
 * comme un simple RPC puis on navigue via `router.push` côté navigateur.
 */
export default function UserStatusActions({
  userId,
  status,
}: {
  userId: string;
  status: UserStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const toast = useToast();
  const { confirm } = useConfirm();

  function run(next: UserStatus, successMessage: string) {
    startTransition(async () => {
      const result = await updateUserStatus(userId, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.push("/admin/clients");
      router.refresh();
    });
  }

  async function askAndDeactivate() {
    const ok = await confirm({
      type: "warning",
      title: "Désactiver ce client ?",
      message:
        "Son compte reste utilisable (connexion, navigation) mais il ne verra plus les tarifs ni les boutons d'achat tant que vous ne l'aurez pas réactivé. Un email de désactivation lui sera envoyé.",
      confirmLabel: "Désactiver",
      cancelLabel: "Annuler",
    });
    if (ok !== true) return;
    run("DEACTIVATED", "Client désactivé");
  }

  function runReactivate() {
    startTransition(async () => {
      const result = await reactivateInactiveClient(userId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Client réactivé avec probation");
      router.refresh();
    });
  }

  if (status === "PENDING") {
    return (
      <>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run("APPROVED", "Client approuvé")}
          className="btn-primary text-sm disabled:opacity-60"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Approuver
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => run("REJECTED", "Inscription refusée")}
          className="btn-danger text-sm disabled:opacity-60"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Rejeter
        </button>
      </>
    );
  }

  if (status === "APPROVED") {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={askAndDeactivate}
        className="btn-danger text-sm disabled:opacity-60"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
        Désactiver
      </button>
    );
  }

  if (status === "DEACTIVATED") {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={runReactivate}
        className="btn-primary text-sm disabled:opacity-60"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Réactiver (probation)
      </button>
    );
  }

  // status === "REJECTED"
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => run("APPROVED", "Client approuvé")}
      className="btn-primary text-sm disabled:opacity-60"
    >
      Approuver
    </button>
  );
}

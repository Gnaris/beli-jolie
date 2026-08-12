"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateUserStatus } from "@/app/actions/admin/updateUserStatus";
import { useToast } from "@/components/ui/Toast";
import type { UserStatus } from "@prisma/client";

/**
 * Boutons Approuver / Rejeter / Révoquer de la fiche client admin.
 *
 * Wrap client-side pour contourner un bug Next.js 16 : quand l'action
 * `updateUserStatus` faisait `redirect()` depuis cette route dynamique
 * (`/admin/utilisateurs/[id]`), Next.js perdait le client reference
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

  function run(next: UserStatus, successMessage: string) {
    startTransition(async () => {
      const result = await updateUserStatus(userId, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(successMessage);
      router.push("/admin/utilisateurs");
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
        onClick={() => run("REJECTED", "Accès révoqué")}
        className="btn-danger text-sm disabled:opacity-60"
      >
        Révoquer
      </button>
    );
  }

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

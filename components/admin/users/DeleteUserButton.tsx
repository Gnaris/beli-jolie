"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DeleteUserConfirmModal from "./DeleteUserConfirmModal";

export default function DeleteUserButton({ userId, userName }: { userId: string; userName: string }) {
  const [showModal, setShowModal] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="btn-danger"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Supprimer définitivement
      </button>

      {showModal && (
        <DeleteUserConfirmModal
          userId={userId}
          userName={userName}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false);
            router.push("/admin/clients");
            router.refresh();
          }}
        />
      )}
    </>
  );
}

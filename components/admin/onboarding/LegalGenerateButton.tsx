"use client";

import { useState, useTransition } from "react";
import { initializeLegalDocuments } from "@/app/actions/admin/legal-documents";
import { useToast } from "@/components/ui/Toast";

export default function LegalGenerateButton({
  initialCount,
}: {
  initialCount: number;
}) {
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleGenerate = () => {
    startTransition(async () => {
      const res = await initializeLegalDocuments();
      if (res.success) {
        if (res.created === 0) {
          toast.info(
            "Déjà en place",
            "Vos documents légaux existent déjà.",
          );
        } else {
          toast.success(
            "Documents générés",
            `${res.created} document${res.created > 1 ? "s" : ""} créé${
              res.created > 1 ? "s" : ""
            } à partir de votre société.`,
          );
          setCount(res.created);
        }
      } else {
        toast.error("Échec", "Impossible de générer les documents.");
      }
    });
  };

  const hasDocs = count > 0;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isPending}
        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white font-semibold text-sm shadow hover:brightness-110 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {isPending ? "Génération…" : hasDocs ? "Régénérer les documents" : "Générer les documents"}
      </button>
      {hasDocs && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
          <p className="font-semibold">✓ {count} document{count > 1 ? "s" : ""} en ligne</p>
          <p className="text-emerald-800/80 mt-0.5">
            Consultables depuis <strong>Admin &rsaquo; Documents légaux</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

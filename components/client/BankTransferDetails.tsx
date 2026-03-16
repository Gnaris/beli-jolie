"use client";

import { useState, useEffect } from "react";

interface BankDetails {
  amount: string;
  currency: string;
  reference: string;
  iban: string | null;
  bic: string | null;
  accountHolderName: string | null;
}

export default function BankTransferDetails({ orderId }: { orderId: string }) {
  const [details, setDetails] = useState<BankDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/client/commandes/${orderId}/bank-details`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setDetails(data);
      })
      .catch(() => setError("Impossible de charger les coordonnees bancaires."))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-[#92400E]">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-xs font-[family-name:var(--font-roboto)]">Chargement des coordonnees bancaires...</span>
      </div>
    );
  }

  if (error || !details) {
    return (
      <p className="text-xs font-[family-name:var(--font-roboto)] text-[#92400E] mt-2">
        {error || "Coordonnees bancaires non disponibles. Contactez-nous si besoin."}
      </p>
    );
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs font-[family-name:var(--font-roboto)] font-semibold text-[#92400E] uppercase tracking-wider">
        Coordonnees pour le virement
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {details.iban && (
          <DetailRow label="IBAN" value={details.iban} onCopy={copyToClipboard} />
        )}
        {details.bic && (
          <DetailRow label="BIC / SWIFT" value={details.bic} onCopy={copyToClipboard} />
        )}
        {details.accountHolderName && (
          <DetailRow label="Beneficiaire" value={details.accountHolderName} onCopy={copyToClipboard} />
        )}
        {details.reference && (
          <DetailRow label="Reference (obligatoire)" value={details.reference} onCopy={copyToClipboard} highlight />
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <div className="bg-[#FEF3C7] rounded-lg px-3 py-2">
          <p className="text-xs font-[family-name:var(--font-roboto)] text-[#92400E]">
            <span className="font-semibold">Montant exact :</span> {details.amount} {details.currency}
          </p>
        </div>
      </div>

      <p className="text-[10px] font-[family-name:var(--font-roboto)] text-[#B45309]">
        Indiquez imperativement la reference ci-dessus dans le motif du virement, sinon le paiement ne pourra pas etre rapproche automatiquement.
      </p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  onCopy,
  highlight = false,
}: {
  label: string;
  value: string;
  onCopy: (text: string) => void;
  highlight?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    onCopy(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`rounded-lg px-3 py-2 flex items-center justify-between gap-2 ${
      highlight ? "bg-[#FDE68A]/40 border border-[#FDE68A]" : "bg-white/60 border border-[#FDE68A]/50"
    }`}>
      <div className="min-w-0">
        <p className="text-[10px] font-[family-name:var(--font-roboto)] text-[#92400E] uppercase tracking-wider">{label}</p>
        <p className={`text-xs font-mono text-[#1A1A1A] truncate ${highlight ? "font-bold" : "font-medium"}`}>
          {value}
        </p>
      </div>
      <button
        onClick={handleCopy}
        className="text-[#92400E] hover:text-[#1A1A1A] transition-colors shrink-0"
        title="Copier"
      >
        {copied ? (
          <svg className="w-3.5 h-3.5 text-[#16A34A]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
          </svg>
        )}
      </button>
    </div>
  );
}

"use client";
import { useState } from "react";
import { updateMinOrderHT } from "@/app/actions/admin/site-config";

interface Props {
  currentValue: number;
}

export default function SettingsMinOrderForm({ currentValue }: Props) {
  const [value, setValue] = useState<string>(String(currentValue));
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setError("");
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) {
      setError("Veuillez saisir un montant valide.");
      setLoading(false);
      return;
    }
    const result = await updateMinOrderHT(num);
    if (result.success) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(result.error ?? "Une erreur est survenue.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="minOrderHT" className="field-label">
          Montant minimum HT
        </label>
        <div className="relative">
          <input
            id="minOrderHT"
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="field-input pr-12"
            placeholder="0"
            disabled={loading}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] pointer-events-none">
            € HT
          </span>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[#EF4444] font-[family-name:var(--font-roboto)]">{error}</p>
      )}
      {success && (
        <p className="text-sm text-[#22C55E] font-[family-name:var(--font-roboto)]">Enregistré avec succès.</p>
      )}

      <button type="submit" disabled={loading} className="btn-primary">
        {loading ? "Enregistrement..." : "Enregistrer"}
      </button>
    </form>
  );
}

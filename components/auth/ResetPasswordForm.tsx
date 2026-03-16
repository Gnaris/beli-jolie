"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  token: string;
}

export default function ResetPasswordForm({ token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!token) {
    return (
      <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-[#1A1A1A] mb-4">
          Lien invalide
        </h1>
        <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)]">
          Ce lien de réinitialisation est invalide ou a expiré. Veuillez faire une nouvelle demande.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Une erreur est survenue.");
        setLoading(false);
      } else {
        router.push("/connexion?reset=success");
      }
    } catch {
      setError("Une erreur réseau est survenue.");
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-[#1A1A1A] mb-2">
        Nouveau mot de passe
      </h1>
      <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-6">
        Choisissez un nouveau mot de passe sécurisé (minimum 8 caractères).
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="field-label">
            Nouveau mot de passe
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
            placeholder="Minimum 8 caractères"
            disabled={loading}
            minLength={8}
            required
          />
        </div>

        <div>
          <label htmlFor="confirm" className="field-label">
            Confirmer le mot de passe
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="field-input"
            placeholder="Répétez le mot de passe"
            disabled={loading}
            minLength={8}
            required
          />
        </div>

        {error && (
          <p className="text-sm text-[#EF4444] font-[family-name:var(--font-roboto)]">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? "Enregistrement..." : "Enregistrer le mot de passe"}
        </button>
      </form>
    </div>
  );
}

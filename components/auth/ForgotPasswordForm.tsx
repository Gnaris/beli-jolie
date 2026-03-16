"use client";
import { useState } from "react";

type State = "idle" | "loading" | "sent";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError("Veuillez saisir votre email.");
      return;
    }
    setState("loading");
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Une erreur est survenue.");
        setState("idle");
      } else {
        setState("sent");
      }
    } catch {
      setError("Une erreur réseau est survenue.");
      setState("idle");
    }
  }

  return (
    <div className="bg-white border border-[#E5E5E5] rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h1 className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-[#1A1A1A] mb-2">
        Mot de passe oublié
      </h1>
      <p className="text-sm text-[#6B6B6B] font-[family-name:var(--font-roboto)] mb-6">
        Entrez votre email, nous vous enverrons un lien de réinitialisation.
      </p>

      {state === "sent" ? (
        <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-4 text-sm font-[family-name:var(--font-roboto)]">
          Un email vous a été envoyé si ce compte existe. Vérifiez votre boîte de réception.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="field-label">
              Adresse email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
              placeholder="votre@email.com"
              disabled={state === "loading"}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-[#EF4444] font-[family-name:var(--font-roboto)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="btn-primary w-full"
          >
            {state === "loading" ? "Envoi en cours..." : "Envoyer le lien"}
          </button>
        </form>
      )}
    </div>
  );
}

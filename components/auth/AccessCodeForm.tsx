"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export default function AccessCodeForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Veuillez saisir un code d'accès.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/access-code/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Code invalide.");
        return;
      }

      // Rediriger vers la page d'accueil
      router.push("/");
      router.refresh();
    } catch {
      setError("Une erreur est survenue. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 border border-border rounded-xl text-sm font-body text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          J&apos;ai un code d&apos;accès invité
        </button>
      ) : (
        <div className="border border-border rounded-xl p-4 space-y-3 animate-fadeIn">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-heading font-semibold text-text-primary">
              Code d&apos;accès invité
            </h3>
            <button
              onClick={() => { setExpanded(false); setError(""); setCode(""); }}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-text-muted font-body">
            Saisissez le code qui vous a été communiqué pour naviguer sur le site.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <div className="bg-red-50 border border-red-200 text-error px-3 py-2 text-xs font-body rounded-lg flex items-center gap-2">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {error}
              </div>
            )}

            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BELI-XXXX"
              maxLength={9}
              className="field-input text-center tracking-[0.3em] font-heading font-bold text-lg uppercase"
              autoFocus
            />

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-50"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Vérification...
                </>
              ) : (
                "Accéder au site"
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

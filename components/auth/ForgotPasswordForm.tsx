"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

type State = "idle" | "loading" | "sent";

export default function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      setError(t("emailRequired"));
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
        setError(data.error ?? t("error"));
        setState("idle");
      } else {
        setState("sent");
      }
    } catch {
      setError(t("networkError"));
      setState("idle");
    }
  }

  return (
    <div className="bg-bg-primary border border-border rounded-2xl p-8 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h1 className="font-heading text-2xl font-bold text-text-primary mb-2">
        {t("title")}
      </h1>
      <p className="text-sm text-text-secondary font-body mb-6">
        {t("subtitle")}
      </p>

      {state === "sent" ? (
        <div className="rounded-xl bg-green-50 border border-green-200 text-green-700 px-4 py-4 text-sm font-body">
          {t("sentMessage")}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="field-label">
              {t("email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-input"
              placeholder={t("emailPlaceholder")}
              disabled={state === "loading"}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-[#EF4444] font-body">{error}</p>
          )}

          <button
            type="submit"
            disabled={state === "loading"}
            className="btn-primary w-full"
          >
            {state === "loading" ? t("loading") : t("submit")}
          </button>
        </form>
      )}
    </div>
  );
}

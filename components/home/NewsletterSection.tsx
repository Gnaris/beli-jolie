"use client";

import { useState } from "react";

/**
 * Section newsletter BtoB
 * Formulaire simple pour inscription aux offres professionnelles
 * Validation basique cote client — la soumission sera geree via une Server Action
 */
export default function NewsletterSection() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  /** Validation basique de l'email avant soumission */
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Veuillez saisir une adresse email valide.");
      return;
    }

    // TODO: remplacer par un appel a une Server Action securisee
    setSubmitted(true);
  }

  return (
    <section
      className="bg-bg-primary py-14 md:py-20 border-t border-border"
      aria-labelledby="newsletter-title"
    >
      <div className="container-site">
        <div className="max-w-2xl mx-auto text-center">
          {/* Decorative icon */}
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-full bg-bg-secondary flex items-center justify-center">
              <svg
                className="w-7 h-7 text-text-secondary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
            </div>
          </div>

          {/* Title */}
          <h2
            id="newsletter-title"
            className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-text-primary section-title-center"
          >
            Offres & Nouveautes Pro
          </h2>

          {/* Description */}
          <p className="mt-5 font-[family-name:var(--font-roboto)] text-base text-text-secondary leading-relaxed">
            Recevez en avant-premiere nos nouvelles collections, offres
            exclusives et conseils tendance directement dans votre boite mail
            professionnelle.
          </p>

          {/* Form or confirmation */}
          {submitted ? (
            <div className="mt-8 bg-accent-light border border-accent/20 px-6 py-5 rounded-xl flex items-center justify-center gap-3">
              <svg
                className="w-5 h-5 text-accent shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <p className="font-[family-name:var(--font-roboto)] text-accent font-medium">
                Merci ! Vous etes inscrit a nos actualites professionnelles.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-8 flex flex-col sm:flex-row gap-3"
              noValidate
              aria-label="Inscription newsletter"
            >
              <div className="flex-1 flex flex-col">
                <label htmlFor="newsletter-email" className="sr-only">
                  Adresse email professionnelle
                </label>
                <input
                  id="newsletter-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Votre email professionnel"
                  required
                  className="field-input"
                  aria-describedby={error ? "newsletter-error" : undefined}
                />
                {error && (
                  <p
                    id="newsletter-error"
                    role="alert"
                    className="text-xs text-error mt-1.5 text-left font-[family-name:var(--font-roboto)]"
                  >
                    {error}
                  </p>
                )}
              </div>
              <button type="submit" className="btn-primary shrink-0">
                S&apos;inscrire
              </button>
            </form>
          )}

          {/* GDPR mention */}
          <p className="mt-4 text-xs font-[family-name:var(--font-roboto)] text-text-muted">
            En vous inscrivant, vous acceptez notre{" "}
            <a
              href="/confidentialite"
              className="underline hover:text-text-secondary transition-colors"
            >
              politique de confidentialite
            </a>
            . Desinscription possible a tout moment.
          </p>
        </div>
      </div>
    </section>
  );
}

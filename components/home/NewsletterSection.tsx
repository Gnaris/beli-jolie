"use client";

import { useState } from "react";

/**
 * Section newsletter BtoB
 * Formulaire simple pour inscription aux offres professionnelles
 * Validation basique côté client — la soumission sera gérée via une Server Action
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

    // TODO: remplacer par un appel à une Server Action sécurisée
    setSubmitted(true);
  }

  return (
    <section className="bg-[#FFFFFF] py-14 md:py-20 border-t border-[#E2E8F0]" aria-labelledby="newsletter-title">
      <div className="container-site">
        <div className="max-w-2xl mx-auto text-center">

          {/* Icône décorative */}
          <div className="flex justify-center mb-6">
            <div className="w-14 h-14 rounded-full bg-[#F1F5F9] flex items-center justify-center">
              <svg className="w-7 h-7 text-[#0F3460]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
          </div>

          {/* Titre */}
          <h2
            id="newsletter-title"
            className="font-[family-name:var(--font-poppins)] text-2xl md:text-3xl font-semibold text-[#0F172A] section-title-center"
          >
            Offres & Nouveautés Pro
          </h2>

          {/* Description */}
          <p className="mt-5 font-[family-name:var(--font-roboto)] text-base text-[#475569] leading-relaxed">
            Recevez en avant-première nos nouvelles collections, offres exclusives et conseils tendance
            directement dans votre boîte mail professionnelle.
          </p>

          {/* Formulaire ou confirmation */}
          {submitted ? (
            <div className="mt-8 bg-[#F1F5F9] border border-[#E2E8F0] px-6 py-5 flex items-center justify-center gap-3">
              <svg className="w-5 h-5 text-[#0F3460] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="font-[family-name:var(--font-roboto)] text-[#0F172A] font-medium">
                Merci ! Vous êtes inscrit à nos actualités professionnelles.
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
                  className="w-full bg-[#FFFFFF] border border-[#E2E8F0] px-4 py-3 text-sm font-[family-name:var(--font-roboto)] text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none focus:border-[#0F3460] transition-colors"
                  aria-describedby={error ? "newsletter-error" : undefined}
                />
                {error && (
                  <p id="newsletter-error" role="alert" className="text-xs text-red-600 mt-1.5 text-left font-[family-name:var(--font-roboto)]">
                    {error}
                  </p>
                )}
              </div>
              <button type="submit" className="btn-primary shrink-0">
                S'inscrire
              </button>
            </form>
          )}

          {/* Mention RGPD */}
          <p className="mt-4 text-xs font-[family-name:var(--font-roboto)] text-[#94A3B8]">
            En vous inscrivant, vous acceptez notre{" "}
            <a href="/confidentialite" className="underline hover:text-[#0F3460] transition-colors">
              politique de confidentialité
            </a>
            . Désinscription possible à tout moment.
          </p>
        </div>
      </div>
    </section>
  );
}

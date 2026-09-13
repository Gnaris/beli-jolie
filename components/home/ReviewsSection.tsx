"use client";

import { useScrollReveal } from "./useScrollReveal";
import type { HomeReview } from "@/lib/customer-reviews";

interface Props {
  reviews: HomeReview[];
  eyebrow: string;
  title: string;
}

export default function ReviewsSection({ reviews, eyebrow, title }: Props) {
  const sectionRef = useScrollReveal();
  if (reviews.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className="scroll-fade-up bg-bg-darker text-white py-20 lg:py-28"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="text-center mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-white/50 mb-3">
            {eyebrow}
          </p>
          <h2
            className="font-heading font-bold"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)", letterSpacing: "-0.02em" }}
          >
            {title}
          </h2>
        </div>

        <div
          className={
            reviews.length === 1
              ? "max-w-2xl mx-auto"
              : reviews.length === 2
              ? "grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto"
              : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          }
        >
          {reviews.map((r) => (
            <article
              key={r.id}
              className="bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col"
            >
              <div className="flex items-center justify-between gap-3">
                <Stars rating={r.rating} />
                <time
                  dateTime={r.publishedAt}
                  className="text-xs text-white/55 shrink-0"
                >
                  {formatReviewDate(r.publishedAt)}
                </time>
              </div>
              <blockquote className="relative mt-5 text-white/85 leading-relaxed text-[15px] flex-1">
                <span
                  aria-hidden
                  className="absolute -top-2 -left-1 text-white/15 font-heading font-bold select-none"
                  style={{ fontSize: "3rem", lineHeight: 1 }}
                >
                  &ldquo;
                </span>
                <span className="relative">{r.text}</span>
              </blockquote>
              <footer className="mt-6 pt-6 border-t border-white/10">
                <p className="font-heading font-semibold text-white">{r.name}</p>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Format déterministe "15 mars 2026" — pas de "il y a X jours" pour éviter
 * un mismatch d'hydratation (Date.now() diffère entre le rendu serveur et le
 * rendu client). Le `<time dateTime>` porte l'ISO pour Google + les lecteurs
 * d'écran.
 */
function formatReviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function Stars({ rating }: { rating: number }) {
  const stars = Array.from({ length: 5 }, (_, i) => i < rating);
  return (
    <div className="flex gap-0.5" aria-label={`Note ${rating} sur 5`}>
      {stars.map((filled, i) => (
        <svg
          key={i}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={filled ? "#ffffff" : "none"}
          stroke={filled ? "#ffffff" : "#ffffff40"}
          strokeWidth={1.5}
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m12 3 2.9 6 6.6.9-4.8 4.7 1.1 6.6L12 18l-5.8 3.2 1.1-6.6L2.5 9.9 9.1 9z"
          />
        </svg>
      ))}
    </div>
  );
}

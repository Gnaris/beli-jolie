"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { useScrollReveal } from "./useScrollReveal";
import type { HomeFaqItem } from "@/lib/home-faq";

interface Props {
  items: HomeFaqItem[];
  eyebrow: string;
  title: string;
  contactTitle: string;
  contactDesc: string;
  contactCta: string;
  contactHref: string;
}

export default function FaqSection({
  items,
  eyebrow,
  title,
  contactTitle,
  contactDesc,
  contactCta,
  contactHref,
}: Props) {
  const sectionRef = useScrollReveal();
  const [openId, setOpenId] = useState<string | null>(items[0]?.id ?? null);

  if (items.length === 0) return null;

  return (
    <section
      ref={sectionRef}
      className="scroll-fade-up bg-bg-darker text-white py-20 lg:py-28"
    >
      <div className="max-w-3xl mx-auto px-6 lg:px-10">
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

        <div className="divide-y divide-white/10 border-y border-white/10">
          {items.map((item) => {
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className="py-1">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  className="w-full py-6 flex items-center justify-between gap-6 text-left group"
                  aria-expanded={isOpen}
                >
                  <span className="font-heading font-semibold text-[15px] sm:text-base leading-snug flex-1">
                    {item.question}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 w-6 h-6 flex items-center justify-center text-white/60 group-hover:text-white transition"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <line x1="5" y1="12" x2="19" y2="12" strokeLinecap="round" />
                      {!isOpen && (
                        <line x1="12" y1="5" x2="12" y2="19" strokeLinecap="round" />
                      )}
                    </svg>
                  </span>
                </button>
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 pr-10 text-white/70 leading-relaxed text-sm sm:text-[15px] font-body">
                      {item.answer}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bloc final : « Vous avez une autre question ? » */}
        <div className="mt-12 rounded-2xl border border-white/10 bg-white/5 px-6 py-6 sm:px-8 sm:py-7 flex flex-col sm:flex-row sm:items-center gap-5 sm:justify-between">
          <div>
            <p className="font-heading font-semibold text-white">
              {contactTitle}
            </p>
            <p className="text-sm text-white/60 mt-1 font-body">{contactDesc}</p>
          </div>
          <Link
            href={contactHref}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full bg-white text-bg-darker font-heading font-semibold text-sm hover:bg-white/90 transition"
          >
            {contactCta} <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useScrollReveal } from "./useScrollReveal";

interface Props {
  productCount: number;
}

export default function StatsBand({ productCount }: Props) {
  const sectionRef = useScrollReveal();
  const formattedCount = productCount.toLocaleString("fr-FR");

  return (
    <section ref={sectionRef} className="scroll-fade-up bg-bg-darker text-white py-14 border-y border-white/10">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 grid sm:grid-cols-3 gap-8">
        <div className="text-center sm:text-left">
          <p className="font-heading font-bold text-5xl lg:text-6xl leading-none">
            {formattedCount}<span className="text-gold">+</span>
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/50">
            Références en ligne
          </p>
        </div>
        <div className="text-center border-l border-r border-white/10 sm:px-8">
          <p className="font-heading font-bold text-5xl lg:text-6xl leading-none">
            48<span className="text-gold">h</span>
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/50">
            Expédition moyenne
          </p>
        </div>
        <div className="text-center sm:text-right">
          <p className="font-heading font-bold text-5xl lg:text-6xl leading-none">
            4,9<span className="text-gold">/5</span>
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-white/50">
            Note moyenne clientes
          </p>
        </div>
      </div>
    </section>
  );
}

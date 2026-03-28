import type { Metadata } from "next";
import { getCachedShopName } from "@/lib/cached-data";

export const metadata: Metadata = {
  title: "Site en maintenance",
  robots: { index: false, follow: false },
};

export default async function MaintenancePage() {
  const shopName = await getCachedShopName();
  return (
    <div className="min-h-screen bg-[#1A1A1A] flex flex-col items-center justify-center px-6 py-12">
      {/* Animated background dots */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #ffffff 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 max-w-lg w-full text-center">
        {/* Logo */}
        <div className="mb-10">
          <span className="font-[family-name:var(--font-poppins)] text-2xl font-bold text-white tracking-tight">
            {shopName}
          </span>
        </div>

        {/* Icon */}
        <div className="mx-auto mb-8 w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-9 h-9 text-white/70"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="font-[family-name:var(--font-poppins)] text-3xl font-bold text-white mb-4 leading-tight">
          Site en maintenance
        </h1>

        {/* Divider */}
        <div className="mx-auto mb-6 w-12 h-px bg-white/20" />

        {/* Message */}
        <p className="font-[family-name:var(--font-roboto)] text-white/60 text-base leading-relaxed mb-4">
          Nous effectuons actuellement des opérations de maintenance afin d&apos;améliorer
          votre expérience sur notre plateforme.
        </p>
        <p className="font-[family-name:var(--font-roboto)] text-white/60 text-base leading-relaxed mb-10">
          Notre équipe travaille activement pour remettre le site en ligne dans les
          meilleurs délais. Merci pour votre patience et votre confiance.
        </p>

        {/* Status badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-10">
          <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-pulse" />
          <span className="font-[family-name:var(--font-roboto)] text-white/50 text-sm">
            Maintenance en cours
          </span>
        </div>

      </div>

      {/* Footer */}
      <div className="relative z-10 mt-12 text-center">
        <p className="font-[family-name:var(--font-roboto)] text-white/20 text-xs">
          Plateforme réservée aux professionnels revendeurs
        </p>
      </div>
    </div>
  );
}

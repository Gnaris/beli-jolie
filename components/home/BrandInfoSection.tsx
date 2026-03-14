const BRAND_BLOCKS = [
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "Acier inoxydable 304",
    description:
      "La majorité de nos bijoux sont fabriqués en acier inoxydable 304, résistant à l'oxydation et hypoallergénique.",
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
      </svg>
    ),
    title: "Livraison rapide",
    description:
      "Recevez votre commande dès le lendemain en France, 5 jours pour les DOM-TOM et 2 à 4 jours pour les autres pays européens.",
  },
  {
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
    title: "SAV disponible",
    description:
      "Service après-vente réactif. Nous garantissons une réponse rapide à toutes vos questions.",
  },
];

export default function BrandInfoSection() {
  return (
    <section className="py-10 bg-white border-y border-[#E5E5E5]">
      <div className="container-site">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {BRAND_BLOCKS.map((block) => (
            <div key={block.title} className="flex flex-col items-center text-center gap-3 px-4">
              <div className="text-[#1A1A1A]">{block.icon}</div>
              <h3 className="font-[family-name:var(--font-poppins)] text-base font-semibold text-[#1A1A1A]">
                {block.title}
              </h3>
              <p className="text-sm text-[#555555] leading-relaxed font-[family-name:var(--font-roboto)]">
                {block.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

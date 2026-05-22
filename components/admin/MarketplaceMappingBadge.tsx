/**
 * Badge unifié pour afficher la correspondance d'un attribut local avec une
 * marketplace (Paris Fashion Shop ou eFashion).
 *
 *  - Si `value` est renseignée → badge vert avec le libellé complet, pastille
 *    verte à gauche, infobulle optionnelle.
 *  - Si `value` est vide → badge ambre « Pas de correspondance » pour signaler
 *    qu'il reste à mapper.
 *
 * Utilisé dans les tableaux des onglets `admin/produits` (catégories, couleurs,
 * compositions, pays, saisons) et leurs équivalents `admin/<entity>`.
 */

interface MarketplaceMappingBadgeProps {
  /** Libellé à afficher dans le badge (ex : « Femme > Bijoux > Bracelets »). */
  value: string | null | undefined;
  /** Infobulle affichée au survol (ex : « id 1234 » ou « Pas encore lié »). */
  title?: string;
}

export default function MarketplaceMappingBadge({ value, title }: MarketplaceMappingBadgeProps) {
  if (value) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0] max-w-[280px]"
        title={title}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E] shrink-0" />
        <span className="truncate">{value}</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded bg-[#FEF3C7] text-[#92400E] border border-[#FCD34D]"
      title={title ?? "Pas encore lié — cliquez sur Modifier pour ajouter la correspondance."}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] shrink-0" />
      <span>Pas de correspondance</span>
    </span>
  );
}

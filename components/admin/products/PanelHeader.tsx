"use client";

/**
 * En-tête d'une section (panel) du formulaire produit — style maquette
 * Ardoise variante B. Titre H2, sous-titre gris, actions optionnelles à droite.
 */
export function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b border-border">
      <div className="min-w-0">
        <h2 className="font-heading text-[20px] leading-tight font-bold tracking-tight text-text-primary">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[12.5px] text-text-muted font-body mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  );
}

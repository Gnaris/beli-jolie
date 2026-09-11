"use client";

/**
 * Case à cocher d'une ligne fiche dans la Vue Mails de /admin/marketing?tab=fiches.
 * Grisée + non-cliquable si la fiche n'a pas d'email (impossible d'envoyer un mail).
 * Réutilise `MailSelectionContext` (générique sur l'ID).
 */

import { useMailSelection } from "./MailSelectionContext";
import { Tooltip } from "@/components/ui/Tooltip";

interface Props {
  ficheId: string;
  hasEmail: boolean;
}

export default function FicheMailRowCheckbox({ ficheId, hasEmail }: Props) {
  const { isSelected, toggle } = useMailSelection();

  if (!hasEmail) {
    return (
      <Tooltip content="Pas d'email — impossible d'envoyer un mail à cette fiche">
        <input
          type="checkbox"
          disabled
          className="w-4 h-4 rounded border-border cursor-not-allowed opacity-40"
          aria-label="Fiche sans email — sélection impossible"
        />
      </Tooltip>
    );
  }

  const on = isSelected(ficheId);
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={() => toggle(ficheId)}
      onClick={(e) => e.stopPropagation()}
      className="w-4 h-4 rounded border-border cursor-pointer accent-violet-600"
      aria-label="Sélectionner cette fiche"
    />
  );
}

"use client";

import { useMailSelection } from "./MailSelectionContext";

export default function MailRowCheckbox({ userId }: { userId: string }) {
  const { isSelected, toggle } = useMailSelection();
  const on = isSelected(userId);
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={() => toggle(userId)}
      onClick={(e) => e.stopPropagation()}
      className="w-4 h-4 rounded border-border cursor-pointer accent-violet-600"
      aria-label="Sélectionner ce client"
    />
  );
}

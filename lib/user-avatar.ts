/**
 * Avatar client : initiales + dégradé stable dérivé d'un identifiant.
 *
 * L'objectif est purement visuel — donner un repère de couleur cohérent
 * pour chaque client dans la liste admin. La couleur est stable pour un
 * même seed (id client), donc l'utilisatrice reconnaît un client entre
 * deux rafraîchissements.
 */

const AVATAR_GRADIENTS: string[] = [
  "bg-gradient-to-br from-slate-500 to-slate-800",
  "bg-gradient-to-br from-emerald-500 to-emerald-800",
  "bg-gradient-to-br from-sky-400 to-sky-700",
  "bg-gradient-to-br from-amber-500 to-amber-700",
  "bg-gradient-to-br from-rose-500 to-rose-800",
  "bg-gradient-to-br from-violet-500 to-violet-800",
  "bg-gradient-to-br from-teal-500 to-teal-800",
  "bg-gradient-to-br from-stone-400 to-stone-700",
];

export function initialsOf(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  const initials = `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
  return initials || "?";
}

export function avatarGradientFor(seed: string): string {
  if (!seed) return AVATAR_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

export const AVATAR_GRADIENT_COUNT = AVATAR_GRADIENTS.length;

// Hauteur attendue du bandeau avant mesure JS : py-2 (16px) + text-sm leading-5 (20px).
// Utilisée par app/layout.tsx pour pré-réserver la place du bandeau côté SSR et éviter
// que le header fixed ne saute vers le bas après hydratation.
//
// Pas de "use client" : la constante doit être importable depuis un Server Component
// (layout racine) sans être transformée par Next.js en stub-client qui throw.
export const ANNOUNCEMENT_BANNER_INITIAL_HEIGHT_PX = 36;

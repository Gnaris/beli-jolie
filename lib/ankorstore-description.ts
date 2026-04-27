/**
 * Ankorstore exige au minimum 30 caractères de description par produit.
 * À l'export, on ajoute toujours "\nRéférence : <ref>" en bas de la description
 * pour aider à passer le seuil. Le formulaire d'édition produit affiche le même
 * compteur "effectif" pour que l'utilisateur sache à quoi s'attendre.
 */

export const ANKORSTORE_DESCRIPTION_MIN_CHARS = 30;

export function composeAnkorstoreDescription(
  description: string | null | undefined,
  reference: string,
): string {
  const baseDesc = (description ?? "").trim();
  const ref = (reference ?? "").trim();
  return baseDesc
    ? `${baseDesc}\nRéférence : ${ref}`
    : `Référence : ${ref}`;
}

export function ankorstoreDescriptionLength(
  description: string | null | undefined,
  reference: string,
): number {
  return composeAnkorstoreDescription(description, reference).length;
}

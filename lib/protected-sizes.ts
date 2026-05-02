export const PROTECTED_SIZE_NAME = "Taille unique";
export const PROTECTED_SIZE_PFS_REF = "TU";

/** Returns true when the size name matches the protected « Taille unique » entry. */
export function isProtectedSizeName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === PROTECTED_SIZE_NAME.toLowerCase();
}

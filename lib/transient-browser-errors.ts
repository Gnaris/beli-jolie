/**
 * Messages d'erreur qui ne reflètent PAS un bug applicatif, mais un hoquet
 * navigateur : onglet suspendu par Safari iOS, worker killed, bfcache, etc.
 * Pour ces cas, le bon traitement est de recharger la page silencieusement,
 * pas d'afficher le fallback d'erreur anxiogène.
 *
 * Patterns identifiés en prod (octobre 2026) depuis les 44 occurrences du
 * message "The object can not be found here" (DOMException WebKit déclenchée
 * quand on tente d'accéder à un objet IndexedDB/MessageChannel qu'iOS a
 * nettoyé pendant que l'onglet était en arrière-plan).
 */
const PATTERNS: RegExp[] = [
  /the object can not be found here/i,
  /the operation is insecure/i,
  /the user denied permission to access the database/i,
  /underlying connection was closed/i,
  /load failed/i,
  /network connection was lost/i,
  /cancelled/i,
  /aborterror|the operation was aborted/i,
];

export function isTransientBrowserError(message: string | undefined | null): boolean {
  if (!message) return false;
  return PATTERNS.some((rx) => rx.test(message));
}

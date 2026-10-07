/**
 * Formatage d'une durée (en millisecondes) en français lisible et compact.
 *
 * Règles :
 *  - < 1 min  → "Xs"
 *  - < 1 h    → "Xmin Ys" (ou "Xmin" si Y=0)
 *  - < 24 h   → "Xh Ymin" (ou "Xh" si Y=0)
 *  - >= 24 h  → "Xj Yh" (ou "Xj" si Y=0)
 *  - négatif  → "0s" (durée bornée pour éviter un affichage absurde si
 *               l'horloge client est en avance sur le serveur)
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds === 0 ? `${totalMinutes}min` : `${totalMinutes}min ${seconds}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}min`;
  }

  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}j` : `${days}j ${hours}h`;
}

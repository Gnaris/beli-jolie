/**
 * Registre singleton (client-side) de la conversation Service Client
 * actuellement affichée à l'écran.
 *
 * Consommé par `useHeartbeat` : chaque ping inclut cet id en body, ce qui
 * permet au serveur de savoir si le client est en train de lire la conv
 * pour laquelle l'admin vient d'écrire (→ pas d'email 5 min plus tard,
 * il verra en direct).
 *
 * Producteurs (appellent set / clear) :
 *   - ChatWidget quand la vue « conversation » est visible + panel ouvert
 *   - ClaimDetailClient quand la page réclamation est montée + onglet actif
 *
 * `null` = « le client n'est sur aucune conversation en ce moment ».
 * On envoie ce `null` explicite au serveur pour effacer la valeur précédente
 * dès que le client ferme le chat / quitte la page.
 */

type Listener = (id: string | null) => void;

let currentId: string | null = null;
const listeners = new Set<Listener>();

export function getActiveConversationId(): string | null {
  return currentId;
}

export function setActiveConversationId(id: string | null): void {
  if (currentId === id) return;
  currentId = id;
  for (const cb of listeners) cb(id);
}

/** S'abonne aux changements. Retourne un unsubscribe. */
export function subscribeActiveConversation(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Réordonnancement des positions d'image dans un slot 0..N-1.
 *
 * Si l'image à `fromPos` est déplacée vers `toPos` :
 * - si `toPos` est occupée → swap classique entre les deux positions ;
 * - si `toPos` est vide   → déplacement simple (libère `fromPos`).
 *
 * `orders` est un tableau de positions (peu importe l'index, c'est la valeur
 * qui représente la position du slot).
 *
 * Retourne le nouveau tableau d'orders. Retourne le tableau inchangé si :
 * - `fromPos === toPos`
 * - `fromPos` n'est pas dans `orders` (slot vide)
 */
export function swapOrDropImageOrder(
  orders: readonly number[],
  fromPos: number,
  toPos: number,
): number[] {
  if (fromPos === toPos) return [...orders];
  if (!orders.includes(fromPos)) return [...orders];
  const toInOrders = orders.includes(toPos);
  return toInOrders
    ? orders.map((o) => (o === fromPos ? toPos : o === toPos ? fromPos : o))
    : orders.map((o) => (o === fromPos ? toPos : o));
}

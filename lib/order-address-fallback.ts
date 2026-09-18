/**
 * Résolution de l'« adresse de commande » avec fallback sur l'adresse
 * de facturation de la société.
 *
 * En retrait boutique (pickup) ou transporteur privé (private), la cliente
 * n'a pas besoin d'adresse de livraison. Si elle n'a pas d'adresse enregistrée
 * dans son carnet, on synthétise un objet « adresse » à partir des champs
 * `address*` stockés sur le compte User (adresse société). Cet objet n'est
 * PAS persisté — il sert uniquement à remplir les colonnes `shipAddress*` de
 * la commande et à donner un pays à Stripe.
 *
 * En livraison classique (delivery) ou fusion (merge), l'adresse reste
 * obligatoire — retrait/privé sont les seuls modes autorisés à retomber sur
 * l'adresse société.
 */

export type OrderAddressLike = {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  company: string | null;
  address1: string;
  address2: string | null;
  zipCode: string;
  city: string;
  country: string;
  phone: string | null;
};

export type OrderAddressDeliveryMode = "delivery" | "pickup" | "private" | "merge";

const FALLBACK_ID = "billing_fallback";

/**
 * Utilise l'adresse société stockée sur le User comme adresse de commande.
 * Retourne `null` si l'un des champs indispensables (rue, code postal, ville,
 * pays) est vide — dans ce cas on ne peut pas synthétiser.
 */
export function buildFallbackAddressFromUser(user: {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  phone: string | null;
  addressStreet: string | null;
  addressComplement: string | null;
  addressZip: string | null;
  addressCity: string | null;
  addressCountry: string | null;
}): OrderAddressLike | null {
  const street = user.addressStreet?.trim();
  const zip = user.addressZip?.trim();
  const city = user.addressCity?.trim();
  const country = user.addressCountry?.trim();
  if (!street || !zip || !city || !country) return null;
  return {
    id: FALLBACK_ID,
    label: "Adresse société",
    firstName: user.firstName?.trim() || "",
    lastName: user.lastName?.trim() || "",
    company: user.company?.trim() || null,
    address1: street,
    address2: user.addressComplement?.trim() || null,
    zipCode: zip,
    city,
    country,
    phone: user.phone?.trim() || null,
  };
}

export function isFallbackAddressAllowed(
  deliveryMode: OrderAddressDeliveryMode | undefined | null,
): boolean {
  return deliveryMode === "pickup" || deliveryMode === "private";
}

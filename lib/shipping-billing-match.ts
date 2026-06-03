// Helpers partagés entre le composant checkout et ses tests pour décider si
// l'option « livrer à la même adresse que la facturation » doit être proposée
// par défaut, et pour retrouver une adresse de livraison existante qui
// correspond mot pour mot à la facturation.

export interface BillingFields {
  addressStreet:     string | null;
  addressComplement: string | null;
  addressZip:        string | null;
  addressCity:       string | null;
  addressCountry:    string | null;
}

export interface ShippingAddressLike {
  id: string;
  address1: string;
  address2: string | null;
  zipCode: string;
  city: string;
  country: string;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

export function isBillingComplete(user: BillingFields): boolean {
  return !!(user.addressStreet && user.addressZip && user.addressCity);
}

export function findAddressMatchingBilling(
  user: BillingFields,
  addresses: ShippingAddressLike[],
): ShippingAddressLike | null {
  if (!isBillingComplete(user)) return null;
  const country = user.addressCountry ?? "FR";
  return addresses.find((a) =>
    norm(a.address1) === norm(user.addressStreet) &&
    norm(a.address2) === norm(user.addressComplement) &&
    norm(a.zipCode)  === norm(user.addressZip)  &&
    norm(a.city)     === norm(user.addressCity) &&
    norm(a.country)  === norm(country)
  ) ?? null;
}

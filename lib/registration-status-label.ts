/**
 * Libellé lisible du statut d'une inscription — utilisé dans la notification
 * push admin ET dans l'email admin pour distinguer :
 *   - un dossier qui attend une validation manuelle
 *   - un dossier qui vient d'être validé automatiquement par les règles
 *   - un dossier refusé automatiquement
 *
 * Les règles d'auto-approbation sont définies dans `/admin/parametres` →
 * carte « Règles d'inscription » (lib/registration-rules.ts).
 */

export type ClientRegistrationStatus = "PENDING" | "APPROVED" | "REJECTED";

export function clientRegistrationStatusLabel(
  status: ClientRegistrationStatus,
): string {
  if (status === "APPROVED") return "validé automatiquement";
  if (status === "REJECTED") return "refusé automatiquement";
  return "en attente de validation";
}

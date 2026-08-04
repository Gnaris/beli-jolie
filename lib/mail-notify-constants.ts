/**
 * Constantes partagées entre le server action et le composant client
 * du bloc « Messagerie » des paramètres admin. Isolé du fichier server
 * pour respecter la contrainte Next.js qui interdit d'exporter autre
 * chose que des fonctions async depuis un fichier `"use server"`.
 */

export interface MailForwardStatus {
  /** Adresse perso vérifiée où sont retransférés les mails de la boîte pro. */
  personalEmail: string;
  /** Adresse pro (contact@…) qui reçoit les mails. Vide si SMTP pas configuré. */
  proEmail: string;
  /** True si le transfert peut fonctionner (perso vérifiée + SMTP prêt). */
  canForward: boolean;
}

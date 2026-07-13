/**
 * Constantes partagées entre le server action et le composant client
 * du réglage « Messagerie ». Séparé pour respecter la contrainte Next.js
 * qui interdit d'exporter autre chose que des fonctions async depuis un
 * fichier `"use server"`.
 */

export type MailNotifyUnit = "minute" | "hour" | "day";

/**
 * Trois modes exclusifs pour les notifications de la boîte pro.
 *  - `off`      : rien envoyé sur le mail perso.
 *  - `summary`  : un e-mail toutes les X unités avec juste le nombre de non lus.
 *  - `forward`  : chaque mail reçu est retransféré immédiatement avec son contenu.
 */
export type MailNotifyMode = "off" | "summary" | "forward";

export interface MailNotifySettings {
  mode: MailNotifyMode;
  intervalValue: number;
  intervalUnit: MailNotifyUnit;
  /** Adresse perso vérifiée où arrivent les notifications (lecture seule ici). */
  personalEmail: string;
}

/** Minimum autorisé entre 2 notifications (protection anti-spam Gmail/Outlook). */
export const MIN_INTERVAL_MINUTES = 30;

/** Convertit une valeur+unité en minutes pour comparer au minimum. */
export function toMinutes(value: number, unit: MailNotifyUnit): number {
  if (unit === "minute") return value;
  if (unit === "hour") return value * 60;
  return value * 60 * 24;
}

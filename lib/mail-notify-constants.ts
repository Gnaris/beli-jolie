/**
 * Constantes partagées entre le server action et le composant client
 * du réglage « Messagerie ». Séparé pour respecter la contrainte Next.js
 * qui interdit d'exporter autre chose que des fonctions async depuis un
 * fichier `"use server"`.
 */

export type MailNotifyUnit = "minute" | "hour" | "day";

export interface MailNotifySettings {
  enabled: boolean;
  email: string;
  intervalValue: number;
  intervalUnit: MailNotifyUnit;
  /** Si actif : chaque nouveau mail reçu dans la boîte pro est transféré à `email`. */
  forwardEnabled: boolean;
}

/** Minimum autorisé entre 2 notifications (protection anti-spam Gmail/Outlook). */
export const MIN_INTERVAL_MINUTES = 30;

/** Convertit une valeur+unité en minutes pour comparer au minimum. */
export function toMinutes(value: number, unit: MailNotifyUnit): number {
  if (unit === "minute") return value;
  if (unit === "hour") return value * 60;
  return value * 60 * 24;
}

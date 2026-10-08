import { z } from "zod";

/** Clé SiteConfig où est stocké l'identifiant Google Tag Manager. */
export const GTM_CONTAINER_ID_KEY = "gtm_container_id";

const GTM_ID_RE = /^GTM-[A-Z0-9]{4,10}$/;

/** Pattern utilisé côté client ET serveur pour valider le format GTM-XXXXXXX. */
export const GTM_CONTAINER_ID_PATTERN = GTM_ID_RE;

/** Schéma Zod partagé entre la server action et les tests. */
export const gtmContainerIdSchema = z
  .string()
  .trim()
  .refine((v) => v === "" || GTM_ID_RE.test(v), {
    message: "Format attendu : GTM-XXXXXXX (lettres majuscules et chiffres).",
  });

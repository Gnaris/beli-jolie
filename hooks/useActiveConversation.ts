"use client";

import { useEffect } from "react";
import { setActiveConversationId } from "@/lib/conversation-presence";

/**
 * Déclare au serveur (via heartbeat) que le client est en train de lire
 * cette conversation Service Client. Passer `null` = « pas dans la conv ».
 *
 * À utiliser dans le ChatWidget (vue conversation ouverte) et dans la page
 * réclamation client. L'unmount / la valeur `null` efface la présence pour
 * que le serveur envoie les mails « nouvelle réponse » via chronomètre 5 min.
 *
 * Cas fermeture brutale d'onglet : on envoie un beacon `activeConversationId
 * = null` sur `pagehide`. Sans ça, le serveur croit encore que le client
 * est sur la conv pendant ~60 s (fenêtre `isOnline`) et l'admin peut
 * répondre sans qu'aucun mail ne parte.
 */
export function useActiveConversation(conversationId: string | null): void {
  useEffect(() => {
    setActiveConversationId(conversationId);

    // Beacon fermeture d'onglet / navigation dure : sendBeacon garantit
    // que le POST part même si la page est en train de se décharger.
    const onPageHide = () => {
      if (typeof navigator === "undefined" || !navigator.sendBeacon) return;
      const blob = new Blob([JSON.stringify({ activeConversationId: null })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/heartbeat", blob);
    };
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", onPageHide);
    }

    return () => {
      // Ne remet à null que si personne d'autre n'a pris la main entre-temps
      // (le prochain composant qui appelle set() écrasera de toute façon).
      setActiveConversationId(null);
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
    };
  }, [conversationId]);
}

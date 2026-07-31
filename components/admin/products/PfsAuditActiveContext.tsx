"use client";

/**
 * Contexte léger qui expose « un audit PFS de masse est-il en cours ? ».
 * Consommé par les pastilles `PfsVerifyBadge` de la liste produits pour
 * afficher toutes les pastilles en état « loading » pendant l'audit —
 * l'utilisatrice voit d'un coup d'œil que la vérif tourne partout.
 *
 * Le provider est monté haut dans le layout admin. Il fait un seul poll
 * partagé (3 s si audit en cours, 15 s sinon), ce qui évite que N pastilles
 * fassent chacune leur propre poll.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getPfsAuditStateAction } from "@/app/actions/admin/pfs-audit";

interface Value {
  auditRunning: boolean;
}

const Ctx = createContext<Value>({ auditRunning: false });

export function usePfsAuditActive(): Value {
  return useContext(Ctx);
}

const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 60_000;

export function PfsAuditActiveProvider({ children }: { children: React.ReactNode }) {
  const [running, setRunning] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await getPfsAuditStateAction();
      if (!aliveRef.current) return;
      if (r.success) setRunning(r.state.status === "RUNNING");
    } catch {
      /* silence — prochain tick réessaie */
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const update = () => setIsVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    if (isVisible) void load();
  }, [isVisible, load]);

  useEffect(() => {
    if (!isVisible) return;
    const delay = running ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    const id = window.setInterval(load, delay);
    return () => window.clearInterval(id);
  }, [running, isVisible, load]);

  const value = useMemo<Value>(() => ({ auditRunning: running }), [running]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

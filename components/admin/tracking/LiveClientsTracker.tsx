"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import CartModal from "./CartModal";

/* ── Types ── */

interface LiveClient {
  id: string;
  firstName: string;
  lastName: string;
  company: string | null;
  currentPage: string | null;
  connectedAt: string | null;
  lastSeenAt: string | null;
  cartAddsCount: number;
  favAddsCount: number;
}

interface SSEData {
  type: string;
  timestamp: string;
  clients: LiveClient[];
}

/* ── Helpers ── */

function pageLabel(page: string | null): { label: string; icon: string; isCheckout: boolean } {
  if (!page) return { label: "—", icon: "location", isCheckout: false };
  if (page.includes("/panier/commande")) return { label: "Commande en cours…", icon: "bolt", isCheckout: true };
  if (page.includes("/panier")) return { label: "Panier", icon: "cart", isCheckout: false };
  if (page.includes("/produits/")) return { label: "Fiche produit", icon: "eye", isCheckout: false };
  if (page.includes("/produits")) return { label: "Catalogue", icon: "grid", isCheckout: false };
  if (page.includes("/collections/")) return { label: "Collection", icon: "grid", isCheckout: false };
  if (page.includes("/collections")) return { label: "Collections", icon: "grid", isCheckout: false };
  if (page.includes("/favoris")) return { label: "Favoris", icon: "heart", isCheckout: false };
  if (page.includes("/commandes")) return { label: "Commandes", icon: "doc", isCheckout: false };
  if (page.includes("/espace-pro")) return { label: "Espace pro", icon: "user", isCheckout: false };
  if (page === "/") return { label: "Accueil", icon: "home", isCheckout: false };
  return { label: page, icon: "location", isCheckout: false };
}

function formatDuration(isoDate: string | null): string {
  if (!isoDate) return "—";
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h${mins > 0 ? ` ${mins}min` : ""}`;
}

/* ── Main Component ── */

export default function LiveClientsTracker() {
  const [clients, setClients] = useState<LiveClient[]>([]);
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);
  const [cartModal, setCartModal] = useState<{ userId: string; userName: string } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/admin/live-clients");
    eventSourceRef.current = es;
    es.onopen = () => setConnected(true);
    es.onmessage = (event) => {
      try {
        const data: SSEData = JSON.parse(event.data);
        if (data.type === "update") setClients(data.clients);
      } catch { /* skip */ }
    };
    es.onerror = () => setConnected(false);
    return () => { es.close(); eventSourceRef.current = null; };
  }, []);

  // Tick every second for live durations
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const openCart = useCallback((userId: string, name: string) => {
    setCartModal({ userId, userName: name });
  }, []);

  const checkoutClients = clients.filter((c) => c.currentPage?.includes("/panier/commande"));

  return (
    <div className="space-y-6">
      {/* ── Header bar ── */}
      <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            {connected ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22C55E]" />
              </>
            ) : (
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#EF4444]" />
            )}
          </span>
          <span className="text-sm font-body text-text-secondary">
            {connected ? "Flux en direct" : "Reconnexion…"}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl font-heading font-bold text-text-primary">
              {clients.length}
            </span>
            <span className="text-sm text-text-muted font-body">
              connecté{clients.length !== 1 ? "s" : ""}
            </span>
          </div>
          {checkoutClients.length > 0 && (
            <div className="flex items-center gap-1.5 bg-[#FEF3C7] text-[#92400E] rounded-full px-3 py-1">
              <svg className="w-3.5 h-3.5 text-[#F59E0B] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-xs font-body font-semibold">
                {checkoutClients.length} commande{checkoutClients.length > 1 ? "s" : ""} en cours
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Checkout alert ── */}
      {checkoutClients.length > 0 && (
        <div className="bg-[#FEF3C7] border border-[#F59E0B]/40 rounded-2xl p-4 flex items-start gap-3 animate-fadeIn">
          <div className="w-10 h-10 rounded-full bg-[#F59E0B]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-[#F59E0B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-heading font-semibold text-[#92400E]">
              {checkoutClients.map((c) => `${c.firstName} ${c.lastName}`).join(", ")}
              {checkoutClients.length === 1 ? " est en train de finaliser sa commande" : " finalisent leur commande"}
            </p>
            <p className="text-xs font-body text-[#92400E]/60 mt-0.5">
              Page de passage de commande
            </p>
          </div>
        </div>
      )}

      {/* ── Empty state ── */}
      {clients.length === 0 && (
        <div className="card p-16 text-center">
          <div className="w-16 h-16 rounded-full bg-bg-secondary flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <p className="font-heading font-semibold text-text-primary mb-1">
            Aucun client connecté
          </p>
          <p className="text-sm text-text-muted font-body">
            Les clients apparaîtront ici dès qu'ils se connecteront.
          </p>
        </div>
      )}

      {/* ── Table header (desktop) ── */}
      {clients.length > 0 && (
        <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr_auto] gap-4 px-5 py-2">
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Client</span>
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Connecté depuis</span>
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Panier</span>
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Favoris</span>
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Page actuelle</span>
          <span className="text-[11px] text-text-muted font-body uppercase tracking-wider">Actions</span>
        </div>
      )}

      {/* ── Client rows ── */}
      {clients.length > 0 && (
        <div className="space-y-2">
          {clients.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              onOpenCart={openCart}
            />
          ))}
        </div>
      )}

      {/* ── Cart modal ── */}
      {cartModal && (
        <CartModal
          userId={cartModal.userId}
          userName={cartModal.userName}
          onClose={() => setCartModal(null)}
        />
      )}
    </div>
  );
}

/* ── Client Row ── */

function ClientRow({
  client,
  onOpenCart,
}: {
  client: LiveClient;
  onOpenCart: (userId: string, name: string) => void;
}) {
  const { label, isCheckout } = pageLabel(client.currentPage);
  const fullName = `${client.firstName} ${client.lastName}`;
  const initials = `${client.firstName?.[0] ?? ""}${client.lastName?.[0] ?? ""}`.toUpperCase();

  return (
    <div
      className={`card transition-all ${
        isCheckout ? "ring-2 ring-[#F59E0B]/60 bg-[#FFFBEB]" : ""
      }`}
    >
      {/* ── Desktop row ── */}
      <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr_1.2fr_auto] gap-4 items-center px-5 py-4">
        {/* Client identity */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-bg-dark flex items-center justify-center text-text-inverse text-xs font-heading font-semibold">
              {initials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22C55E] border-2 border-white" />
            </span>
          </div>
          <div className="min-w-0">
            <Link
              href={`/admin/utilisateurs/${client.id}`}
              className="text-sm font-heading font-semibold text-text-primary hover:underline truncate block"
            >
              {fullName}
            </Link>
            {client.company && (
              <p className="text-xs font-body text-text-muted truncate">
                {client.company}
              </p>
            )}
          </div>
        </div>

        {/* Duration */}
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-body text-text-secondary font-medium">
            {formatDuration(client.connectedAt)}
          </span>
        </div>

        {/* Cart count */}
        <div>
          {client.cartAddsCount > 0 ? (
            <span className="inline-flex items-center gap-1 bg-bg-dark text-text-inverse rounded-full px-2.5 py-0.5 text-xs font-body font-semibold">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {client.cartAddsCount} ajout{client.cartAddsCount > 1 ? "s" : ""}
            </span>
          ) : (
            <span className="text-xs text-text-muted font-body">—</span>
          )}
        </div>

        {/* Favorites count */}
        <div>
          {client.favAddsCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-[#EF4444] text-xs font-body font-semibold">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
              </svg>
              {client.favAddsCount}
            </span>
          ) : (
            <span className="text-xs text-text-muted font-body">—</span>
          )}
        </div>

        {/* Current page */}
        <div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-body font-medium ${
              isCheckout
                ? "bg-[#FEF3C7] text-[#92400E] font-semibold"
                : "bg-bg-secondary text-text-secondary"
            }`}
          >
            {isCheckout && (
              <svg className="w-3 h-3 text-[#F59E0B] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {label}
          </span>
        </div>

        {/* Actions */}
        <div>
          <button
            onClick={() => onOpenCart(client.id, fullName)}
            className="flex items-center gap-1.5 text-xs font-body font-medium text-text-secondary hover:text-text-primary bg-bg-secondary hover:bg-bg-tertiary rounded-lg px-3 py-2 transition-colors"
            aria-label={`Voir le panier de ${fullName}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
            Voir panier
          </button>
        </div>
      </div>

      {/* ── Mobile card ── */}
      <div className="lg:hidden p-4 space-y-3">
        {/* Top: identity + page */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full bg-bg-dark flex items-center justify-center text-text-inverse text-sm font-heading font-semibold">
                {initials}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22C55E] opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22C55E] border-2 border-white" />
              </span>
            </div>
            <div className="min-w-0">
              <Link
                href={`/admin/utilisateurs/${client.id}`}
                className="text-sm font-heading font-semibold text-text-primary hover:underline truncate block"
              >
                {fullName}
              </Link>
              {client.company && (
                <p className="text-xs font-body text-text-muted truncate">
                  {client.company}
                </p>
              )}
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-body font-medium flex-shrink-0 ${
              isCheckout
                ? "bg-[#FEF3C7] text-[#92400E] font-semibold"
                : "bg-bg-secondary text-text-secondary"
            }`}
          >
            {isCheckout && (
              <svg className="w-3 h-3 text-[#F59E0B] animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            )}
            {label}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-3 text-xs font-body text-text-muted pl-[52px]">
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatDuration(client.connectedAt)}
          </span>
          {client.cartAddsCount > 0 && (
            <span className="flex items-center gap-1 font-semibold text-text-primary">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              {client.cartAddsCount}
            </span>
          )}
          {client.favAddsCount > 0 && (
            <span className="flex items-center gap-1 text-[#EF4444] font-semibold">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
              </svg>
              {client.favAddsCount}
            </span>
          )}
        </div>

        {/* Action button */}
        <div className="pl-[52px]">
          <button
            onClick={() => onOpenCart(client.id, fullName)}
            className="flex items-center gap-1.5 text-xs font-body font-medium text-text-secondary hover:text-text-primary bg-bg-secondary hover:bg-bg-tertiary rounded-lg px-3 py-2 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
            Voir panier
          </button>
        </div>
      </div>
    </div>
  );
}

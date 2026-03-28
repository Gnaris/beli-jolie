"use client";

import { useState } from "react";
import { updateAccessCodeNote, deactivateAccessCode, reactivateAccessCode } from "@/app/actions/admin/access-codes";

interface ViewItem {
  id: string;
  pageUrl: string;
  productId: string | null;
  productName: string | null;
  productRef: string | null;
  createdAt: string;
}

interface AccessCodeData {
  id: string;
  code: string;
  note: string | null;
  isActive: boolean;
  expiresAt: string;
  createdAt: string;
  firstAccessAt: string | null;
  lastAccessAt: string | null;
  usedBy: string | null;
  usedByName: string | null;
  usedAt: string | null;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    company: string;
  } | null;
  views: ViewItem[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimeDiff(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}min`;
}

export default function AccessCodeDetail({ data }: { data: AccessCodeData }) {
  const [note, setNote] = useState(data.note ?? "");
  const [saving, setSaving] = useState(false);
  const [isActive, setIsActive] = useState(data.isActive);

  const isExpired = new Date(data.expiresAt) < new Date();
  const isUsed = !!data.usedBy;

  // Durée de navigation estimée
  const duration = data.firstAccessAt && data.lastAccessAt
    ? getTimeDiff(data.firstAccessAt, data.lastAccessAt)
    : null;

  // Produits uniques vus
  const uniqueProducts = data.views
    .filter((v) => v.productId)
    .reduce((acc, v) => {
      if (v.productId && !acc.find((p) => p.productId === v.productId)) {
        acc.push(v);
      }
      return acc;
    }, [] as ViewItem[]);

  async function handleSaveNote() {
    setSaving(true);
    await updateAccessCodeNote(data.id, note);
    setSaving(false);
  }

  async function handleToggle() {
    if (isActive) {
      await deactivateAccessCode(data.id);
    } else {
      await reactivateAccessCode(data.id);
    }
    setIsActive(!isActive);
  }

  return (
    <div className="space-y-6">
      {/* Infos générales */}
      <div className="card p-6 space-y-4">
        <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wider">
          Informations
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="stat-card">
            <p className="text-xs text-text-muted font-body">Statut</p>
            <p className="mt-1">
              {isUsed ? (
                <span className="badge badge-success">Inscrit</span>
              ) : !isActive ? (
                <span className="badge badge-neutral">Désactivé</span>
              ) : isExpired ? (
                <span className="badge badge-error">Expiré</span>
              ) : data.firstAccessAt ? (
                <span className="badge badge-info">En cours de navigation</span>
              ) : (
                <span className="badge badge-warning">Actif — non utilisé</span>
              )}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-xs text-text-muted font-body">Expiration</p>
            <p className="text-sm font-medium text-text-primary mt-1">{formatDate(data.expiresAt)}</p>
          </div>

          <div className="stat-card">
            <p className="text-xs text-text-muted font-body">Pages vues</p>
            <p className="text-2xl font-bold text-text-primary mt-1">{data.views.length}</p>
          </div>

          <div className="stat-card">
            <p className="text-xs text-text-muted font-body">Produits consultés</p>
            <p className="text-2xl font-bold text-text-primary mt-1">{uniqueProducts.length}</p>
          </div>

          {data.firstAccessAt && (
            <div className="stat-card">
              <p className="text-xs text-text-muted font-body">Premier accès</p>
              <p className="text-sm font-medium text-text-primary mt-1">{formatDate(data.firstAccessAt)}</p>
            </div>
          )}

          {duration && (
            <div className="stat-card">
              <p className="text-xs text-text-muted font-body">Durée estimée</p>
              <p className="text-sm font-medium text-text-primary mt-1">{duration}</p>
            </div>
          )}
        </div>

        {/* Bouton activer/désactiver */}
        {!isUsed && (
          <button onClick={handleToggle} className={isActive ? "btn-secondary" : "btn-primary"}>
            {isActive ? "Désactiver le code" : "Réactiver le code"}
          </button>
        )}
      </div>

      {/* Client inscrit */}
      {data.user && (
        <div className="card p-6 space-y-3">
          <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wider">
            Client inscrit
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm font-body">
            <div>
              <p className="text-text-muted text-xs">Nom</p>
              <p className="text-text-primary font-medium">{data.user.firstName} {data.user.lastName}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Entreprise</p>
              <p className="text-text-primary font-medium">{data.user.company}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Email</p>
              <p className="text-text-primary font-medium">{data.user.email}</p>
            </div>
            {data.usedAt && (
              <div>
                <p className="text-text-muted text-xs">Date d&apos;inscription</p>
                <p className="text-text-primary font-medium">{formatDate(data.usedAt)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Note admin */}
      <div className="card p-6 space-y-3">
        <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wider">
          Note admin
        </h2>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ajouter une note..."
          className="field-input min-h-[80px] resize-y"
          rows={3}
        />
        <button onClick={handleSaveNote} disabled={saving} className="btn-primary">
          {saving ? "Enregistrement..." : "Enregistrer la note"}
        </button>
      </div>

      {/* Produits consultés */}
      {uniqueProducts.length > 0 && (
        <div className="card p-6 space-y-3">
          <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wider">
            Produits consultés ({uniqueProducts.length})
          </h2>
          <div className="divide-y divide-border">
            {uniqueProducts.map((v) => (
              <div key={v.id} className="py-2 flex items-center justify-between text-sm font-body">
                <div>
                  <p className="text-text-primary font-medium">{v.productName ?? "Produit supprimé"}</p>
                  {v.productRef && <p className="text-xs text-text-muted">Réf: {v.productRef}</p>}
                </div>
                <span className="text-xs text-text-muted">{formatDate(v.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historique complet */}
      <div className="card p-6 space-y-3">
        <h2 className="font-heading text-sm font-semibold text-text-primary uppercase tracking-wider">
          Historique de navigation ({data.views.length})
        </h2>
        {data.views.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            Aucune activité enregistrée.
          </p>
        ) : (
          <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
            {data.views.map((v) => (
              <div key={v.id} className="py-2 flex items-center justify-between text-sm font-body">
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary truncate">{v.pageUrl}</p>
                  {v.productName && (
                    <p className="text-xs text-text-muted">
                      Produit : {v.productName}
                    </p>
                  )}
                </div>
                <span className="text-xs text-text-muted shrink-0 ml-2">{formatDate(v.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

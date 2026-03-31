"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface SyncJob {
  id: string;
  status: string;
  totalProducts: number;
  processedProducts: number;
  createdProducts: number;
  updatedProducts: number;
  skippedProducts: number;
  errorProducts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  logs?: { productLogs?: string[]; imageLogs?: string[] };
}

interface AnalysisResult {
  totalProducts: number;
  newProducts: number;
  existingProducts: number;
  unmappedProductTypes: { id: number; count: number }[];
}

export default function AnkorstoreSyncClient() {
  const [job, setJob] = useState<SyncJob | null>(null);
  const [counts, setCounts] = useState<{ akCount: number; akHasMore: boolean; bjSyncedCount: number } | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [limit, setLimit] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [countRes, jobRes] = await Promise.all([
        fetch("/api/admin/ankorstore-sync/count"),
        fetch("/api/admin/ankorstore-sync"),
      ]);
      const countData = await countRes.json();
      const jobData = await jobRes.json();
      setCounts(countData);
      if (jobData.job) {
        setJob(jobData.job);
        if (jobData.job.logs?.productLogs) setLogs(jobData.job.logs.productLogs);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!job || job.status !== "RUNNING") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/ankorstore-sync");
        const data = await res.json();
        if (data.job) {
          setJob(data.job);
          if (data.job.logs?.productLogs) setLogs(data.job.logs.productLogs);
          if (data.job.status !== "RUNNING") {
            setSyncing(false);
            fetchData();
          }
        }
      } catch {
        // ignore
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [job?.status, fetchData]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await fetch("/api/admin/ankorstore-sync/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: limit > 0 ? limit : undefined }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "result") {
              setAnalysis(data);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/ankorstore-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: limit > 0 ? limit : undefined }),
      });
      const data = await res.json();
      if (data.jobId) {
        setJob({ id: data.jobId, status: "RUNNING", processedProducts: 0, totalProducts: 0, createdProducts: 0, updatedProducts: 0, skippedProducts: 0, errorProducts: 0, errorMessage: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
    } catch {
      setSyncing(false);
    }
  }

  async function handleCancel() {
    await fetch("/api/admin/ankorstore-sync/cancel", { method: "POST" });
    fetchData();
  }

  const isRunning = job?.status === "RUNNING";

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Ankorstore</h1>
        <Link href="/admin/ankorstore/mapping" className="text-sm text-brand hover:underline">
          Mapping cat&eacute;gories &rarr;
        </Link>
      </div>

      {counts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">{counts.akCount}{counts.akHasMore ? "+" : ""}</div>
            <div className="text-sm text-text-secondary">Produits Ankorstore</div>
          </div>
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">{counts.bjSyncedCount}</div>
            <div className="text-sm text-text-secondary">Synchronis&eacute;s en BDD</div>
          </div>
          <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
            <div className="text-2xl font-bold text-text-primary">
              {counts.akCount > 0 ? Math.round((counts.bjSyncedCount / counts.akCount) * 100) : 0}%
            </div>
            <div className="text-sm text-text-secondary">Couverture</div>
          </div>
        </div>
      )}

      <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm text-text-secondary">Limite :</label>
            <input
              type="number"
              value={limit || ""}
              onChange={(e) => setLimit(Number(e.target.value) || 0)}
              placeholder="Illimit&eacute;"
              className="w-28 px-3 py-1.5 border border-border rounded-lg text-sm bg-bg-primary text-text-primary"
            />
          </div>
          <button onClick={handleAnalyze} disabled={analyzing || isRunning} className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-bg-secondary transition disabled:opacity-50">
            {analyzing ? "Analyse..." : "Analyser"}
          </button>
          <button onClick={isRunning ? handleCancel : handleSync} disabled={analyzing || (syncing && !isRunning)} className={`px-4 py-2 text-sm text-white rounded-lg transition disabled:opacity-50 ${isRunning ? "bg-red-500 hover:bg-red-600" : "bg-brand hover:opacity-90"}`}>
            {isRunning ? "Annuler" : syncing ? "D&eacute;marrage..." : "Lancer la sync"}
          </button>
        </div>

        {analysis && (
          <div className="p-4 bg-bg-secondary rounded-lg text-sm space-y-2">
            <div>Produits AK : <strong>{analysis.totalProducts}</strong></div>
            <div>Nouveaux : <strong>{analysis.newProducts}</strong></div>
            <div>D&eacute;j&agrave; existants : <strong>{analysis.existingProducts}</strong></div>
            {analysis.unmappedProductTypes.length > 0 && (
              <div className="text-amber-600">
                &#x26A0; {analysis.unmappedProductTypes.length} types non mapp&eacute;s &mdash;{" "}
                <Link href="/admin/ankorstore/mapping" className="underline">Configurer le mapping</Link>
              </div>
            )}
          </div>
        )}
      </div>

      {job && (
        <div className="bg-bg-primary border border-border rounded-2xl p-6 shadow-[0_1px_4px_rgba(0,0,0,0.06)] space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Derni&egrave;re synchronisation</h2>
            <span className={`badge ${job.status === "COMPLETED" ? "badge-success" : job.status === "RUNNING" ? "badge-info" : job.status === "FAILED" ? "badge-error" : job.status === "CANCELLED" ? "badge-warning" : "badge-neutral"}`}>
              {job.status}
            </span>
          </div>

          {isRunning && job.processedProducts > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm text-text-secondary">
                <span>{job.processedProducts} trait&eacute;s</span>
              </div>
              <div className="w-full bg-bg-secondary rounded-full h-2">
                <div className="bg-brand h-2 rounded-full transition-all animate-pulse" style={{ width: "100%" }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div><span className="text-text-secondary">Cr&eacute;&eacute;s :</span> <strong>{job.createdProducts}</strong></div>
            <div><span className="text-text-secondary">Mis &agrave; jour :</span> <strong>{job.updatedProducts}</strong></div>
            <div><span className="text-text-secondary">Ignor&eacute;s :</span> <strong>{job.skippedProducts}</strong></div>
            <div><span className="text-text-secondary">Erreurs :</span> <strong className="text-red-500">{job.errorProducts}</strong></div>
            <div><span className="text-text-secondary">Date :</span> {new Date(job.createdAt).toLocaleDateString("fr-FR")}</div>
          </div>

          {job.errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{job.errorMessage}</div>
          )}

          {logs.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-text-secondary hover:text-text-primary">Logs ({logs.length})</summary>
              <pre className="mt-2 p-3 bg-bg-secondary rounded-lg overflow-auto max-h-60 text-xs font-mono">{logs.join("\n")}</pre>
            </details>
          )}
        </div>
      )}

      <div className="text-center">
        <Link href="/admin/ankorstore/historique" className="text-sm text-brand hover:underline">
          Voir l&apos;historique complet &rarr;
        </Link>
      </div>
    </div>
  );
}

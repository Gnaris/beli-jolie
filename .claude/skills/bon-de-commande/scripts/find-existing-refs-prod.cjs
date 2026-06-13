#!/usr/bin/env node
/**
 * Comme find-existing-refs.cjs mais interroge la BDD de PRODUCTION
 * via SSH sur le VPS Hostinger (root@72.61.106.128). C'est la BDD
 * que la cliente utilise vraiment quand elle importe sur son site,
 * donc c'est elle qui fait foi pour décider quoi exclure.
 *
 * Usage :
 *   node find-existing-refs-prod.cjs <parsed.json>
 *
 * Sortie : JSON tableau des références qui existent déjà en BDD prod.
 *
 * Implémentation : envoie le parsed.json sur le VPS via scp puis lance
 * find-existing-refs.cjs (copie sur /tmp) sur le VPS via ssh.
 * Utilise spawnSync sans shell=true pour éviter toute injection.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PARSED = process.argv[2];
if (!PARSED) {
  console.error("Usage : node find-existing-refs-prod.cjs <parsed.json>");
  process.exit(1);
}

const VPS = "root@72.61.106.128";
const localScript = path.join(__dirname, "find-existing-refs.cjs");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf-8" });
  if (r.status !== 0) {
    console.error(`[${cmd}] échec :`, r.stderr || "code " + r.status);
    process.exit(r.status || 1);
  }
  return r.stdout;
}

// 1. Pousser le script et le parsed.json sur le VPS
run("scp", ["-q", localScript, `${VPS}:/tmp/find-existing-refs.cjs`]);
run("scp", ["-q", PARSED, `${VPS}:/tmp/bdc-parsed.json`]);

// 2. Lancer sur le VPS (dans le dossier projet pour avoir Prisma + .env)
const out = run("ssh", [
  VPS,
  "cd /var/www/beliandjolie && node /tmp/find-existing-refs.cjs /tmp/bdc-parsed.json",
]);

process.stdout.write(out.trim());

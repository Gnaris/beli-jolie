# deploy-fast.ps1
#
# Deploy rapide vers le VPS Hostinger :
#   1) Pre-flight : verifie qu'aucun job n'est en cours cote prod
#   2) Verifie git local (commit + push si necessaire)
#   3) Backup complet sur le VPS (base + code + env + uploads hardlinks)
#   4) Build local (npm run build) — au lieu de builder sur le VPS
#   5) Compresse .next -> tarball, SCP vers le VPS
#   6) Sur le VPS : git reset --hard, npm install, prisma, extrait .next, pm2 restart
#   7) Verifie les 2 tenants (beliandjolie.com + issyma.fr) via curl
#
# Objectif : passer de ~10 min a ~1-2 min par deploy.
#
# Usage :
#   powershell -ExecutionPolicy Bypass -File scripts/deploy/deploy-fast.ps1

$ErrorActionPreference = "Stop"

# ─── Constantes ─────────────────────────────────────────────────────────
$VPS         = "root@72.61.106.128"
$REMOTE_DIR  = "/var/www/beliandjolie"
$TIMESTAMP   = Get-Date -Format "yyyyMMdd-HHmmss"
$BACKUP_DIR  = "/root/backups/pre-push-$TIMESTAMP"
$TARBALL     = "next-deploy-$TIMESTAMP.tar.gz"
$SCRIPT_ROOT = Split-Path -Parent $PSScriptRoot
$PROJECT_ROOT = Split-Path -Parent $SCRIPT_ROOT

# ─── Helpers UI ─────────────────────────────────────────────────────────
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !!  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "    XX  $msg" -ForegroundColor Red; exit 1 }

function ConfirmContinue($question) {
  $ans = Read-Host "$question (o/N)"
  if ($ans -ne "o" -and $ans -ne "O") { Fail "Annule par utilisateur" }
}

# ─── Depuis la racine du projet ─────────────────────────────────────────
Set-Location $PROJECT_ROOT
Write-Host "Racine projet : $PROJECT_ROOT" -ForegroundColor Gray

$deployStart = Get-Date

# ═══════════════════════════════════════════════════════════════════════
# 1) PRE-FLIGHT — verifier qu'aucun job n'est en cours cote prod
# ═══════════════════════════════════════════════════════════════════════
Step "Pre-flight : jobs en cours sur le VPS ?"

$preflightSql = @'
SELECT '1-marketplace' AS job, status, marketplace AS detail, COUNT(*) AS n FROM MarketplaceRefreshJob WHERE status IN ('QUEUED','IN_PROGRESS','AWAITING_CALLBACK') GROUP BY status, marketplace
UNION ALL SELECT '2-images', status, '', COUNT(*) FROM ImageProcessingJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status
UNION ALL SELECT '3-ankor_callbacks', status, type, COUNT(*) FROM AnkorstoreOperation WHERE status='PENDING' GROUP BY status, type
UNION ALL SELECT '4-translations', status, '', COUNT(*) FROM TranslationJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status
UNION ALL SELECT '5-emails', status, '', COUNT(*) FROM EmailQueueJob WHERE status IN ('PENDING','PROCESSING') GROUP BY status
'@

$preflightResult = ssh $VPS "mysql beliandjolie -e ""$preflightSql"""
$preflightLines  = $preflightResult -split "`n" | Where-Object { $_ -match '^\d' -or $_ -match '^[1-5]-' }
if ($preflightLines.Count -gt 0) {
  Warn "Jobs actifs detectes :"
  Write-Host $preflightResult
  ConfirmContinue "Continuer quand meme (le pm2 restart va tuer ces workers) ?"
} else {
  Ok "Aucun job en cours"
}

# Verif logs Ankorstore recents (60 dernieres sec)
$recentAnkor = ssh $VPS "tail -200 /root/.pm2/logs/beliandjolie-out.log 2>/dev/null | grep -E 'Ankorstore Catalog|Preview job|Import' | tail -5"
if ($recentAnkor) {
  Warn "Activite Ankorstore recente dans les logs :"
  Write-Host $recentAnkor
  ConfirmContinue "Continuer ?"
}

# ═══════════════════════════════════════════════════════════════════════
# 2) GIT — commit + push si necessaire (code identique local / GH / VPS)
# ═══════════════════════════════════════════════════════════════════════
Step "Etat git local"

$gitStatus = git status --porcelain
if ($gitStatus) {
  Warn "Modifications non commitees detectees :"
  Write-Host $gitStatus
  ConfirmContinue "Commit + push maintenant ?"
  $commitMsg = Read-Host "Message de commit"
  if (-not $commitMsg) { Fail "Message vide" }
  git add -A
  if ($LASTEXITCODE -ne 0) { Fail "git add a echoue" }
  git commit -m $commitMsg
  if ($LASTEXITCODE -ne 0) { Fail "git commit a echoue" }
}

# Verifie qu'on a des commits en avance sur origin
git fetch origin master 2>&1 | Out-Null
$ahead = git rev-list --count origin/master..HEAD
if ($ahead -eq 0) {
  Warn "Aucun commit en avance sur origin/master — deploy quand meme ?"
  ConfirmContinue "Continuer (utile si tu veux juste re-builder / re-deployer) ?"
} else {
  Step "git push ($ahead commit(s) en avance)"
  git push
  if ($LASTEXITCODE -ne 0) { Fail "git push a echoue" }
  Ok "Push GitHub ok"
}

# ═══════════════════════════════════════════════════════════════════════
# 3) BACKUP — mysqldump + git archive + .env + uploads (hardlinks)
# ═══════════════════════════════════════════════════════════════════════
Step "Backup VPS (base + code + env + uploads)"

$backupScript = @"
set -e
mkdir -p $BACKUP_DIR
cd $REMOTE_DIR
mysqldump --single-transaction --routines --triggers --events --databases beliandjolie | gzip > $BACKUP_DIR/db-beliandjolie.sql.gz
git rev-parse HEAD > $BACKUP_DIR/git-head.txt
git archive --format=tar HEAD | gzip > $BACKUP_DIR/code-git-head.tar.gz
cp .env $BACKUP_DIR/.env.backup
chmod 600 $BACKUP_DIR/.env.backup
cp -al public/uploads $BACKUP_DIR/uploads-public
cp -al private/uploads $BACKUP_DIR/uploads-private
du -sh $BACKUP_DIR/db-beliandjolie.sql.gz $BACKUP_DIR/code-git-head.tar.gz 2>/dev/null | awk '{print "     " $0}'
"@

ssh $VPS $backupScript
if ($LASTEXITCODE -ne 0) { Fail "Backup a echoue" }
Ok "Backup dans $BACKUP_DIR"

# ═══════════════════════════════════════════════════════════════════════
# 4) BUILD LOCAL — la vraie acceleration
# ═══════════════════════════════════════════════════════════════════════
Step "Build local (Next.js + Turbopack)"

$env:NODE_OPTIONS = "--max-old-space-size=4096"
$buildStart = Get-Date
npm run build
if ($LASTEXITCODE -ne 0) { Fail "Build local a echoue — corrige les erreurs et relance" }
$buildDur = (Get-Date) - $buildStart
Ok ("Build en {0:mm\:ss}" -f $buildDur)

if (-not (Test-Path ".next")) { Fail ".next/ absent apres build" }

# ═══════════════════════════════════════════════════════════════════════
# 5) PACKAGE + UPLOAD — tarball .next (sans cache) puis SCP
# ═══════════════════════════════════════════════════════════════════════
Step "Compression .next -> tarball (exclut .next/cache)"

if (Test-Path $TARBALL) { Remove-Item $TARBALL -Force }
tar --exclude='.next/cache' -czf $TARBALL .next
if ($LASTEXITCODE -ne 0) { Fail "tar a echoue" }

$sizeMB = [math]::Round((Get-Item $TARBALL).Length / 1MB, 1)
Ok "Tarball : $sizeMB Mo"

Step "Upload tarball vers le VPS"
$uploadStart = Get-Date
scp $TARBALL "${VPS}:${REMOTE_DIR}/${TARBALL}"
if ($LASTEXITCODE -ne 0) {
  Remove-Item $TARBALL -ErrorAction SilentlyContinue
  Fail "scp a echoue"
}
$uploadDur = (Get-Date) - $uploadStart
Remove-Item $TARBALL -Force
Ok ("Upload en {0:mm\:ss}" -f $uploadDur)

# ═══════════════════════════════════════════════════════════════════════
# 6) SYNC VPS — git reset, install, prisma, extract, restart
# ═══════════════════════════════════════════════════════════════════════
Step "Sync VPS (git reset + install + prisma + extract + restart)"

$remoteScript = @"
set -e
cd $REMOTE_DIR

echo '  -> git fetch + reset --hard origin/master'
git fetch origin
git reset --hard origin/master

echo '  -> npm install (no-op si package-lock inchange)'
npm install --no-audit --no-fund

echo '  -> prisma generate + db push'
npx prisma generate
npx prisma db push --skip-generate

echo '  -> extract .next depuis tarball local'
rm -rf .next
tar xzf $TARBALL
rm $TARBALL

echo '  -> pm2 restart beliandjolie'
pm2 restart beliandjolie
"@

$syncStart = Get-Date
ssh $VPS $remoteScript
if ($LASTEXITCODE -ne 0) { Fail "Sync VPS a echoue — verifie les logs pm2" }
$syncDur = (Get-Date) - $syncStart
Ok ("Sync VPS en {0:mm\:ss}" -f $syncDur)

# ═══════════════════════════════════════════════════════════════════════
# 7) VERIF VISITEUR — les 2 tenants doivent repondre avec leur title
# ═══════════════════════════════════════════════════════════════════════
Step "Verification visiteur (curl 2 tenants)"

Start-Sleep -Seconds 4  # laisser pm2 remonter proprement

function CheckTenant($url, $label) {
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 3
    if ($resp.Content -match '<title>(.*?)</title>') {
      Ok "$label : $($Matches[1])"
      return $true
    } else {
      Warn "$label : reponse recue mais pas de <title>"
      return $false
    }
  } catch {
    Warn "$label : ECHEC ($($_.Exception.Message))"
    return $false
  }
}

$bjOk    = CheckTenant "https://beliandjolie.com" "beliandjolie"
$issyOk  = CheckTenant "https://issyma.fr"        "issyma       "

# ═══════════════════════════════════════════════════════════════════════
# 8) POST-CHECK — aucun job marketplace bloque en IN_PROGRESS
# ═══════════════════════════════════════════════════════════════════════
Step "Post-check : aucun job bloque ?"
$stuck = ssh $VPS "mysql beliandjolie -e ""SELECT status, marketplace, COUNT(*) AS n FROM MarketplaceRefreshJob WHERE status='IN_PROGRESS' GROUP BY status, marketplace"""
Write-Host $stuck

# ═══════════════════════════════════════════════════════════════════════
# RECAP
# ═══════════════════════════════════════════════════════════════════════
$totalDur = (Get-Date) - $deployStart
Write-Host ""
if ($bjOk -and $issyOk) {
  Write-Host ("=== DEPLOY TERMINE en {0:mm\:ss} ===" -f $totalDur) -ForegroundColor Green
} else {
  Write-Host ("=== DEPLOY TERMINE en {0:mm\:ss} (mais un tenant repond mal — verifie) ===" -f $totalDur) -ForegroundColor Yellow
}
Write-Host "Backup : $BACKUP_DIR" -ForegroundColor Gray
Write-Host ""
Write-Host "En cas de probleme, rollback :" -ForegroundColor Gray
Write-Host "  ssh $VPS" -ForegroundColor Gray
Write-Host "  cd $REMOTE_DIR" -ForegroundColor Gray
Write-Host "  git reset --hard `$(cat $BACKUP_DIR/git-head.txt)" -ForegroundColor Gray
Write-Host "  zcat $BACKUP_DIR/db-beliandjolie.sql.gz | mysql" -ForegroundColor Gray
Write-Host "  npm install && npx prisma generate" -ForegroundColor Gray
Write-Host "  NODE_OPTIONS='--max-old-space-size=4096' npm run build" -ForegroundColor Gray
Write-Host "  pm2 restart beliandjolie" -ForegroundColor Gray

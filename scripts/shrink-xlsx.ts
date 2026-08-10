import { promises as fs } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import JSZip from "jszip";

const SRC = process.argv[2];
const OUT = process.argv[3];
const QUALITY = Number(process.argv[4] ?? 82);

if (!SRC || !OUT) {
  console.error("Usage: tsx scripts/shrink-xlsx.ts <input.xlsx> <output.xlsx> [quality=82]");
  process.exit(1);
}

const WORK = path.join(process.env.TEMP ?? "/tmp", `xlsx-shrink-${Date.now()}`);

function run(cmd: string, args: string[], opts: { cwd?: string } = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: opts.cwd });
  if (r.status !== 0) throw new Error(`${cmd} failed with status ${r.status}`);
}

async function main() {
  await fs.mkdir(WORK, { recursive: true });
  console.log("Extraction ->", WORK);
  run("unzip", ["-q", SRC, "-d", WORK]);

  const mediaDir = path.join(WORK, "xl", "media");
  let entries: string[] = [];
  try {
    entries = await fs.readdir(mediaDir);
  } catch {
    console.error("Pas de dossier xl/media dans ce xlsx");
    process.exit(1);
  }

  const renamed: Record<string, string> = {};
  let savedBytes = 0;
  let count = 0;

  for (const name of entries) {
    if (!/\.png$/i.test(name)) continue;
    const full = path.join(mediaDir, name);
    const buf = await fs.readFile(full);
    const meta = await sharp(buf).metadata();
    const hasAlpha = meta.hasAlpha || meta.channels === 4;

    if (hasAlpha) {
      const optimized = await sharp(buf).png({ compressionLevel: 9, palette: true }).toBuffer();
      if (optimized.length < buf.length) {
        await fs.writeFile(full, optimized);
        savedBytes += buf.length - optimized.length;
      }
    } else {
      const jpeg = await sharp(buf).jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
      if (jpeg.length < buf.length) {
        const newName = name.replace(/\.png$/i, ".jpeg");
        await fs.writeFile(path.join(mediaDir, newName), jpeg);
        await fs.unlink(full);
        renamed[name] = newName;
        savedBytes += buf.length - jpeg.length;
      }
    }
    count++;
  }

  console.log(
    `Traité ${count} images, ${Object.keys(renamed).length} converties en JPEG, économie brute ${(savedBytes / 1024 / 1024).toFixed(1)} Mo`,
  );

  const relsGlob = ["xl/drawings/_rels", "xl/_rels", "xl/media/_rels"];
  for (const rel of relsGlob) {
    const dir = path.join(WORK, rel);
    let files: string[] = [];
    try { files = await fs.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".rels")) continue;
      const p = path.join(dir, f);
      let txt = await fs.readFile(p, "utf8");
      let changed = false;
      for (const [oldN, newN] of Object.entries(renamed)) {
        if (txt.includes(oldN)) {
          txt = txt.split(oldN).join(newN);
          changed = true;
        }
      }
      if (changed) await fs.writeFile(p, txt);
    }
  }

  const ctPath = path.join(WORK, "[Content_Types].xml");
  let ct = await fs.readFile(ctPath, "utf8");
  const usesJpeg = Object.keys(renamed).length > 0;
  if (usesJpeg && !/Extension="jpeg"/i.test(ct) && !/Extension="jpg"/i.test(ct)) {
    ct = ct.replace(
      "</Types>",
      `<Default Extension="jpeg" ContentType="image/jpeg"/></Types>`,
    );
    await fs.writeFile(ctPath, ct);
  }

  console.log("Recompression ->", OUT);
  try { await fs.unlink(OUT); } catch {}
  const zip = new JSZip();
  async function walk(dir: string, rel: string) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    for (const it of items) {
      const abs = path.join(dir, it.name);
      const zpath = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        await walk(abs, zpath);
      } else {
        const data = await fs.readFile(abs);
        // Images déjà compressées => STORE ; XML => DEFLATE 9
        const isImage = /\.(jpe?g|png|gif|webp)$/i.test(it.name);
        zip.file(zpath, data, {
          compression: isImage ? "STORE" : "DEFLATE",
          compressionOptions: { level: 9 },
        });
      }
    }
  }
  await walk(WORK, "");
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  await fs.writeFile(OUT, buf);

  const before = (await fs.stat(SRC)).size;
  const after = (await fs.stat(OUT)).size;
  console.log(
    `Avant: ${(before / 1024 / 1024).toFixed(2)} Mo | Après: ${(after / 1024 / 1024).toFixed(2)} Mo | Gain: ${(((before - after) / before) * 100).toFixed(1)}%`,
  );

  await fs.rm(WORK, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

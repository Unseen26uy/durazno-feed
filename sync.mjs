import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// Copia las noticias públicas de durazno.uy a un JSON estable y espeja las imágenes
// en este repositorio. Se ejecuta desde GitHub Actions, que sí tiene acceso al portal.
const HOME = "https://durazno.uy";
const API = process.env.DURAZNO_API || `${HOME}/api/noticias?pagina=1&por_pagina=30`;
const RAW_BASE = process.env.DURAZNO_RAW_BASE || "https://raw.githubusercontent.com/Unseen26uy/durazno-feed/main";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MEDIA_DIR = "media";
const MAX_ITEMS = Number(process.env.DURAZNO_MAX_ITEMS || 30);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, { attempts = 3, accept = "application/json", timeout = 45000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { "User-Agent": UA, Accept: accept, Referer: `${HOME}/noticias` }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(4000 * attempt);
    }
  }
  throw lastError;
}

function absoluteImage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, HOME).toString();
  } catch {
    return "";
  }
}

function fileNameFor(url) {
  const clean = url.split("?")[0];
  const match = clean.match(/\.(jpe?g|png|webp|gif|avif)$/i);
  const ext = (match ? match[1] : "jpg").toLowerCase().replace("jpeg", "jpg");
  return `${createHash("sha1").update(url).digest("hex").slice(0, 24)}.${ext}`;
}

const response = await fetchWithRetry(API);
const data = await response.json();
const rows = (Array.isArray(data) ? data : data?.items || [])
  .filter((row) => row && row.titulo && row.alias)
  .slice(0, MAX_ITEMS);

if (!rows.length) throw new Error("La API de durazno.uy no devolvió noticias");

await fs.mkdir(MEDIA_DIR, { recursive: true });

const referenced = new Map();
const prepared = [];
for (const row of rows) {
  const src = absoluteImage(row.imagen || row.og_imagen);
  const item = { ...row };
  if (src && /\/uploads\//i.test(src)) {
    const name = fileNameFor(src);
    referenced.set(name, src);
    item.imagen = `${RAW_BASE}/${MEDIA_DIR}/${name}`;
  } else {
    item.imagen = src;
  }
  // Se normaliza también og_imagen para que ningún consumidor vuelva a la ruta relativa.
  item.og_imagen = item.imagen;
  prepared.push(item);
}

// Solo se descargan las imágenes nuevas: las que ya están en el repositorio se reutilizan.
let downloaded = 0;
for (const [name, src] of referenced) {
  const dest = path.join(MEDIA_DIR, name);
  try {
    await fs.access(dest);
    continue;
  } catch {
    /* falta: se descarga */
  }
  try {
    const image = await fetchWithRetry(src, {
      accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8",
      timeout: 30000
    });
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!bytes.length) throw new Error("imagen vacía");
    await fs.writeFile(dest, bytes);
    downloaded += 1;
  } catch (error) {
    console.warn(`No se pudo copiar ${src}: ${error.message}`);
    // Se deja la URL original para que la app intente leerla directamente.
    const published = `${RAW_BASE}/${MEDIA_DIR}/${name}`;
    for (const item of prepared) if (item.imagen === published) item.imagen = src;
  }
}

// Se eliminan las imágenes que ya no usa ninguna noticia para que el repositorio no crezca.
let removed = 0;
for (const name of await fs.readdir(MEDIA_DIR).catch(() => [])) {
  if (referenced.has(name)) continue;
  await fs.rm(path.join(MEDIA_DIR, name), { force: true });
  removed += 1;
}

const payload = {
  generated_at: new Date().toISOString(),
  source: "durazno.uy",
  api: API,
  items: prepared
};
await fs.writeFile("durazno.json", `${JSON.stringify(payload, null, 1)}\n`);

const withImage = prepared.filter((item) => item.imagen).length;
console.log(`noticias=${prepared.length} con_imagen=${withImage} imagenes_nuevas=${downloaded} imagenes_eliminadas=${removed}`);
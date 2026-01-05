// FILE: app/api/ocr/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type VisionVertex = { x?: number; y?: number };
type VisionAnnot = {
  description?: string;
  boundingPoly?: { vertices?: VisionVertex[] };
};

type TokenBox = {
  text: string;
  digits: string;
  digitLen: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status },
  );
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function digitsOf(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function hasLetters(s: string) {
  return /[a-zA-Z]/.test(s || "");
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";

  if (!b64) return null;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    throw new Error(
      "Falha ao ler o service account. Verifique o base64 do JSON em GCP_KEY_BASE64 (ou GOOGLE_SERVICE_ACCOUNT_B64).",
    );
  }
}

async function getVisionAuth() {
  const apiKey =
    process.env.GCP_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";

  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) {
    throw new Error(
      "Sem credenciais: configure GCP_VISION_API_KEY (ou GOOGLE_VISION_API_KEY) ou GCP_KEY_BASE64.",
    );
  }

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não consegui obter access token (GoogleAuth).");

  return { mode: "bearer" as const, token };
}

function polyToBox(annot: VisionAnnot): TokenBox | null {
  const text = (annot.description || "").trim();
  if (!text) return null;

  const vs = annot.boundingPoly?.vertices || [];
  if (!vs.length) return null;

  const xs = vs.map((v) => safeNum(v.x, 0));
  const ys = vs.map((v) => safeNum(v.y, 0));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const digits = digitsOf(text);

  return {
    text,
    digits,
    digitLen: digits.length,
    minX,
    maxX,
    minY,
    maxY,
    w,
    h,
    cx: minX + w / 2,
    cy: minY + h / 2,
  };
}

function docBounds(tokens: TokenBox[]) {
  const minX = Math.min(...tokens.map((t) => t.minX));
  const maxX = Math.max(...tokens.map((t) => t.maxX));
  const minY = Math.min(...tokens.map((t) => t.minY));
  const maxY = Math.max(...tokens.map((t) => t.maxY));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { minX, maxX, minY, maxY, w, h };
}

type Row = { cy: number; avgH: number; items: TokenBox[] };

function clusterRows(tokens: TokenBox[]) {
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy);
  const rows: Row[] = [];

  for (const t of sorted) {
    let placed = false;

    for (const r of rows) {
      const tol = Math.max(12, Math.min(t.h, r.avgH) * 0.7);
      if (Math.abs(t.cy - r.cy) <= tol) {
        r.items.push(t);
        r.cy = r.items.reduce((s, x) => s + x.cy, 0) / r.items.length;
        r.avgH = r.items.reduce((s, x) => s + x.h, 0) / r.items.length;
        placed = true;
        break;
      }
    }

    if (!placed) rows.push({ cy: t.cy, avgH: t.h, items: [t] });
  }

  for (const r of rows) r.items.sort((a, b) => a.minX - b.minX);
  return rows;
}

function compactnessMetrics(tokens: TokenBox[], docW: number) {
  if (!tokens.length) {
    return {
      spanX: 0,
      sumW: 1,
      avgW: 1,
      maxGap: 0,
      compactness: 999,
      spanNorm: 1,
    };
  }

  const tks = [...tokens].sort((a, b) => a.minX - b.minX);
  const first = tks[0];
  const last = tks[tks.length - 1];

  const spanX = last.maxX - first.minX;
  const sumW = tks.reduce((acc, t) => acc + t.w, 0);
  const avgW = sumW / Math.max(1, tks.length);

  let maxGap = 0;
  for (let i = 1; i < tks.length; i++) {
    const gap = Math.max(0, tks[i].minX - tks[i - 1].maxX);
    maxGap = Math.max(maxGap, gap);
  }

  const compactness = spanX / Math.max(1, sumW);
  const spanNorm = spanX / Math.max(1, docW);

  return { spanX, sumW, avgW, maxGap, compactness, spanNorm };
}

function findDecimalRight(main: TokenBox, digitTokens: TokenBox[]) {
  const mainCy = main.cy;
  const mainH = main.h;

  const candidates = digitTokens
    .filter((t) => t !== main)
    .filter((t) => t.digitLen === 1)
    .filter((t) => Math.abs(t.cy - mainCy) <= Math.max(8, mainH * 0.7))
    .filter((t) => t.minX >= main.maxX)
    .map((t) => {
      const gap = t.minX - main.maxX;
      return { t, gap };
    })
    .filter(({ gap }) => gap >= 0 && gap <= Math.max(50, mainH * 3.0))
    .sort((a, b) => a.gap - b.gap);

  return candidates[0]?.t || null;
}

/**
 * HORÍMETRO
 */
function pickHorimetroDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length) {
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };
  }

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) {
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };
  }

  const bounds = docBounds(clean);
  const maxH = Math.max(...clean.map((t) => t.h));
  const minBigH = maxH * 0.7;

  const longTokens = clean
    .filter((t) => t.h >= minBigH)
    .filter((t) => t.digitLen >= 4 && t.digitLen <= 7)
    .sort((a, b) => {
      if (b.h !== a.h) return b.h - a.h;
      return b.digitLen - a.digitLen;
    });

  if (longTokens.length) {
    const main = longTokens[0];
    let digits = main.digits;
    let used: TokenBox[] = [main];

    // tenta achar decimal separado
    if (digits.length === 4) {
      const dec = findDecimalRight(main, clean);
      if (dec) {
        digits = digits + dec.digits;
        used = [main, dec];
        dbg.decFound = true;
      }
    }

    dbg.method = "long-token";
    dbg.maxH = maxH;
    dbg.minBigH = minBigH;
    dbg.bounds = { w: bounds.w, h: bounds.h };
    return { digits, used, dbg };
  }

  // fallback por linha (mais robusto em painéis)
  const big = clean.filter((t) => t.h >= minBigH).sort((a, b) => a.minX - b.minX);
  const rows = clusterRows(big);

  const rowCands = rows
    .map((r) => {
      const strong = r.items.filter((t) => t.h >= r.avgH * 0.8);
      const digits = strong.map((t) => t.digits).join("");
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);
      const m = compactnessMetrics(strong, bounds.w);

      return { r, strong, digits, yNorm, m };
    })
    .filter((c) => c.digits.length >= 4 && c.digits.length <= 7)
    .filter((c) => c.m.spanNorm <= 0.7 && c.m.compactness <= 4.0)
    .map((c) => ({
      ...c,
      score:
        c.r.avgH *
        (1 + c.digits.length) *
        (1 + c.yNorm * 0.25) /
        Math.max(1, c.m.compactness),
    }))
    .sort((a, b) => b.score - a.score);

  if (!rowCands.length) {
    dbg.method = "none-row";
    dbg.maxH = maxH;
    return { digits: "", used: [], dbg };
  }

  const picked = rowCands[0];
  let digits = picked.digits;
  let used = [...picked.strong];

  if (digits.length === 4) {
    const main = picked.strong[picked.strong.length - 1];
    const dec = main ? findDecimalRight(main, clean) : null;
    if (dec) {
      digits = digits + dec.digits;
      used.push(dec);
      dbg.decFound = true;
    }
  }

  dbg.method = "row";
  dbg.maxH = maxH;
  dbg.minBigH = minBigH;
  dbg.top = rowCands.slice(0, 6).map((c) => ({
    digits: c.digits,
    score: c.score,
    yNorm: c.yNorm,
    avgH: c.r.avgH,
    spanNorm: c.m.spanNorm,
    compactness: c.m.compactness,
  }));

  return { digits, used, dbg };
}

function parseHorimetro(digits: string) {
  const d = digitsOf(digits);
  if (d.length < 4) return null;

  // 5+ => último dígito é decimal
  if (d.length >= 5) {
    const intPart = d.slice(0, -1);
    const dec = d.slice(-1);
    const i = parseInt(intPart, 10);
    const dc = parseInt(dec, 10);
    if (!Number.isFinite(i) || !Number.isFinite(dc)) return null;
    const v = i + dc / 10;
    if (v < 0 || v > 1000000) return null;
    return { value: v, best_input: `${i},${dc}` };
  }

  const i = parseInt(d, 10);
  if (!Number.isFinite(i)) return null;
  if (i < 0 || i > 1000000) return null;
  return { value: i, best_input: `${i},0` };
}

/**
 * ODOMETRO
 * - por padrão retorna inteiro (sem decimal)
 * - se detectar vírgula/ponto no token usado, remove o último dígito como decimal
 */
function pickOdometroDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length) {
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };
  }

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) {
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };
  }

  const bounds = docBounds(clean);
  const maxH = Math.max(...clean.map((t) => t.h));
  const minBigH = maxH * 0.65;

  // preferir tokens longos e grandes (5–8 dígitos)
  const cands = clean
    .filter((t) => t.h >= minBigH)
    .filter((t) => t.digitLen >= 4 && t.digitLen <= 9)
    .map((t) => {
      const yNorm = clamp((t.cy - bounds.minY) / bounds.h, 0, 1);
      // odômetro geralmente no meio/baixo do painel
      const yBonus = yNorm >= 0.25 && yNorm <= 0.9 ? 1.15 : 1.0;
      return { t, yNorm, score: t.h * (1 + t.digitLen) * yBonus };
    })
    .sort((a, b) => b.score - a.score);

  if (cands.length) {
    const main = cands[0].t;
    const hasDecMark = /[.,]/.test(main.text || "");
    dbg.method = "long-token";
    dbg.hasDecMark = hasDecMark;
    dbg.maxH = maxH;
    dbg.minBigH = minBigH;
    return { digits: main.digits, used: [main], dbg };
  }

  // fallback por linha
  const big = clean.filter((t) => t.h >= minBigH);
  const rows = clusterRows(big);

  const rowCands = rows
    .map((r) => {
      const strong = r.items.filter((t) => t.h >= r.avgH * 0.82);
      const digits = strong.map((t) => t.digits).join("");
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);
      const m = compactnessMetrics(strong, bounds.w);
      return { r, strong, digits, yNorm, m };
    })
    .filter((c) => c.digits.length >= 4 && c.digits.length <= 9)
    .filter((c) => c.m.compactness <= 5.0)
    .map((c) => ({
      ...c,
      score: c.r.avgH * (1 + c.digits.length) * (1 + c.yNorm * 0.2) / Math.max(1, c.m.compactness),
    }))
    .sort((a, b) => b.score - a.score);

  if (!rowCands.length) {
    dbg.method = "none-row";
    return { digits: "", used: [], dbg };
  }

  const picked = rowCands[0];
  dbg.method = "row";
  dbg.top = rowCands.slice(0, 6).map((c) => ({
    digits: c.digits,
    score: c.score,
    yNorm: c.yNorm,
    avgH: c.r.avgH,
    compactness: c.m.compactness,
  }));
  return { digits: picked.digits, used: picked.strong, dbg };
}

function parseOdometro(digits: string, used: TokenBox[]) {
  const d = digitsOf(digits);
  if (!d || d.length < 3) return null;

  const hasDecMark = used.some((t) => /[.,]/.test(t.text || ""));

  // se houver marca decimal (ex: 00093,7), remove último dígito
  const raw = hasDecMark && d.length >= 2 ? d.slice(0, -1) : d;

  // remove zeros à esquerda mas preserva "0"
  const cleaned = raw.replace(/^0+/, "") || "0";

  const value = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(value)) return null;
  if (value < 0 || value > 999999999) return null;

  return { value, best_input: String(value), hasDecMark };
}

/**
 * ABASTECIMENTO (LITROS)
 * - evita contador pequeno (linha inferior) filtrando candidatos com muitos dígitos
 * - usa só linhas com 3–6 dígitos (litros reais)
 */
function pickAbastecimentoDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);

  const pool = clean.filter((t) => t.digitLen <= 6);
  const maxH = Math.max(...(pool.length ? pool : clean).map((t) => t.h));
  const minBigH = maxH * 0.72;

  const big = clean.filter((t) => t.digitLen <= 6 && t.h >= minBigH);

  dbg.maxH = maxH;
  dbg.minBigH = minBigH;
  dbg.bigCount = big.length;

  if (!big.length) return { digits: "", used: [], dbg: { ...dbg, method: "no-big" } };

  const rows = clusterRows(big);

  const rowCands = rows
    .map((r) => {
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

      // abastecimento fica na metade superior da foto (contador baixo é inferior)
      if (yNorm > 0.78) return null;

      const strong = r.items.filter((t) => t.h >= r.avgH * 0.85);
      const digitsRaw = strong.map((t) => t.digits).join("");

      // 🔥 evita contador pequeno: geralmente vira 7+ dígitos
      if (digitsRaw.length < 3 || digitsRaw.length > 6) return null;

      // também evita linhas muito “espalhadas” (contador costuma ser espaçado)
      const m = compactnessMetrics(strong, bounds.w);
      if (m.spanNorm > 0.75 || m.compactness > 4.5 || m.maxGap > m.avgW * 4.0) return null;

      return { r, strong, digitsRaw, yNorm };
    })
    .filter(Boolean) as { r: Row; strong: TokenBox[]; digitsRaw: string; yNorm: number }[];

  const tokenCands = big
    .filter((t) => t.digitLen >= 3 && t.digitLen <= 5)
    .map((t) => {
      const yNorm = clamp((t.cy - bounds.minY) / bounds.h, 0, 1);
      return { t, digitsRaw: t.digits, yNorm };
    })
    .filter((c) => c.yNorm <= 0.78)
    .filter((c) => c.digitsRaw.length >= 3 && c.digitsRaw.length <= 6);

  type Cand = {
    digitsRaw: string;
    used: TokenBox[];
    avgH: number;
    cy: number;
    yNorm: number;
    src: string;
  };

  const candidates: Cand[] = [];

  for (const c of rowCands) {
    candidates.push({
      digitsRaw: c.digitsRaw,
      used: c.strong,
      avgH: c.r.avgH,
      cy: c.r.cy,
      yNorm: c.yNorm,
      src: "row",
    });
  }

  for (const c of tokenCands) {
    candidates.push({
      digitsRaw: c.digitsRaw,
      used: [c.t],
      avgH: c.t.h,
      cy: c.t.cy,
      yNorm: c.yNorm,
      src: "token",
    });
  }

  // ordena: maior avgH primeiro; empate -> mais acima
  candidates.sort((a, b) => {
    if (b.avgH !== a.avgH) return b.avgH - a.avgH;
    return a.cy - b.cy;
  });

  dbg.top = candidates.slice(0, 10).map((c) => ({
    src: c.src,
    digits: c.digitsRaw,
    avgH: c.avgH,
    yNorm: c.yNorm,
  }));

  if (!candidates.length) return { digits: "", used: [], dbg: { ...dbg, method: "no-cands" } };

  for (const c of candidates) {
    let d = digitsOf(c.digitsRaw);

    if (d.length === 3) d = d.padStart(4, "0");
    if (d.length > 4) d = d.slice(-4);
    if (d.length !== 4) continue;

    dbg.method = `picked-${c.src}`;
    dbg.picked = { digitsRaw: c.digitsRaw, digits: d, avgH: c.avgH, yNorm: c.yNorm };
    return { digits: d, used: c.used, dbg };
  }

  return { digits: "", used: [], dbg: { ...dbg, method: "no-4digits" } };
}

function parseAbastecimento(digits: string) {
  let d = digitsOf(digits);
  if (!d) return null;

  if (d.length === 3) d = d.padStart(4, "0");
  if (d.length > 4) d = d.slice(-4);
  if (d.length !== 4) return null;

  const intPart = d.slice(0, 3);
  const dec = d.slice(3);

  const i = parseInt(intPart, 10);
  const dc = parseInt(dec, 10);
  if (!Number.isFinite(i) || !Number.isFinite(dc)) return null;

  const value = i + dc / 10;
  if (value < 0 || value > 1200) return null;

  return { value, best_input: `${i},${dc}` };
}

async function visionTextDetection(imageBytes: Uint8Array | Buffer) {
  const base64 = Buffer.from(imageBytes).toString("base64");
  const payload = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "TEXT_DETECTION" }],
      },
    ],
  };

  const auth = await getVisionAuth();

  const endpoint =
    auth.mode === "apikey"
      ? `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(auth.apiKey)}`
      : `https://vision.googleapis.com/v1/images:annotate`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers:
      auth.mode === "bearer"
        ? { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Vision API falhou: HTTP ${res.status} - ${JSON.stringify(data)?.slice(0, 500)}`);
  }
  return data;
}

async function preprocessBaseImage(input: Uint8Array) {
  // aplica orientação EXIF e limita tamanho (performance/custo)
  const img = sharp(Buffer.from(input)).rotate();
  const meta = await img.metadata();

  let w = meta.width || 0;
  let h = meta.height || 0;

  const MAX = 2200;
  let pipeline = img;

  if (w && h && (w > MAX || h > MAX)) {
    const scale = Math.min(MAX / w, MAX / h);
    const nw = Math.max(1, Math.floor(w * scale));
    const nh = Math.max(1, Math.floor(h * scale));
    pipeline = pipeline.resize(nw, nh, { fit: "inside" });
    w = nw;
    h = nh;
  }

  const buf = await pipeline.toBuffer();
  const meta2 = await sharp(buf).metadata();
  return { buf, width: meta2.width || w || 1, height: meta2.height || h || 1 };
}

async function runVision(buf: Buffer) {
  const vision = await visionTextDetection(buf);
  const resp0 = vision?.responses?.[0] || {};
  const textAnnotations: VisionAnnot[] = resp0?.textAnnotations || [];
  const rawFull = (textAnnotations?.[0]?.description || "").trim();

  const tokens: TokenBox[] = (textAnnotations || [])
    .slice(1)
    .map(polyToBox)
    .filter(Boolean) as TokenBox[];

  const digitTokens = tokens.filter((t) => t.digitLen > 0);

  return { rawFull, tokens, digitTokens };
}

type CropBox = { left: number; top: number; width: number; height: number };

function pickCropBoxAbastecimento(digitTokens: TokenBox[], imgW: number, imgH: number) {
  const dbg: any = {};
  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { box: null as CropBox | null, dbg: { method: "no-clean" } };

  const bounds = docBounds(clean);

  const pool = clean.filter((t) => t.digitLen <= 6);
  const maxH = Math.max(...(pool.length ? pool : clean).map((t) => t.h));
  const minBigH = maxH * 0.70;

  const big = clean.filter((t) => t.digitLen <= 6 && t.h >= minBigH);
  if (!big.length) {
    // fallback: pega faixa central superior onde normalmente está o visor grande
    const box: CropBox = {
      left: Math.floor(imgW * 0.05),
      top: Math.floor(imgH * 0.22),
      width: Math.floor(imgW * 0.90),
      height: Math.floor(imgH * 0.55),
    };
    return { box, dbg: { method: "fallback-band", maxH, minBigH, bigCount: 0 } };
  }

  const rows = clusterRows(big);

  const rowCands = rows
    .map((r) => {
      const strong = r.items.filter((t) => t.h >= r.avgH * 0.85);
      const digitsRaw = strong.map((t) => t.digits).join("");
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

      // evita parte inferior (contador pequeno)
      if (yNorm > 0.78) return null;

      // litros reais raramente vira 7+ dígitos
      if (digitsRaw.length < 3 || digitsRaw.length > 6) return null;

      return { r, strong, digitsRaw, yNorm };
    })
    .filter(Boolean) as { r: Row; strong: TokenBox[]; digitsRaw: string; yNorm: number }[];

  if (!rowCands.length) {
    const box: CropBox = {
      left: Math.floor(imgW * 0.05),
      top: Math.floor(imgH * 0.22),
      width: Math.floor(imgW * 0.90),
      height: Math.floor(imgH * 0.55),
    };
    return { box, dbg: { method: "fallback-band-2", maxH, minBigH, bigCount: big.length } };
  }

  // escolhe a linha mais “forte” e mais alta
  const picked = rowCands
    .map((c) => ({
      ...c,
      score: c.r.avgH * (1 + c.digitsRaw.length) * (1 + (1 - c.yNorm) * 0.25),
    }))
    .sort((a, b) => b.score - a.score)[0];

  const xs1 = picked.strong.map((t) => t.minX);
  const xs2 = picked.strong.map((t) => t.maxX);
  const ys1 = picked.strong.map((t) => t.minY);
  const ys2 = picked.strong.map((t) => t.maxY);

  const minX = Math.min(...xs1);
  const maxX = Math.max(...xs2);
  const minY = Math.min(...ys1);
  const maxY = Math.max(...ys2);

  const spanX = Math.max(1, maxX - minX);
  const avgH = picked.r.avgH;

  const marginL = Math.max(24, Math.floor(spanX * 0.30));
  const marginR = Math.max(34, Math.floor(spanX * 0.40) + Math.floor(avgH * 1.2));
  const marginT = Math.max(28, Math.floor(avgH * 1.6));
  const marginB = Math.max(28, Math.floor(avgH * 2.0));

  const left = clamp(Math.floor(minX - marginL), 0, imgW - 2);
  const top = clamp(Math.floor(minY - marginT), 0, imgH - 2);
  const right = clamp(Math.floor(maxX + marginR), left + 2, imgW);
  const bottom = clamp(Math.floor(maxY + marginB), top + 2, imgH);

  const box: CropBox = {
    left,
    top,
    width: Math.max(2, right - left),
    height: Math.max(2, bottom - top),
  };

  dbg.method = "row-strong";
  dbg.maxH = maxH;
  dbg.minBigH = minBigH;
  dbg.picked = { digitsRaw: picked.digitsRaw, yNorm: picked.yNorm, avgH: picked.r.avgH };
  dbg.box = box;

  return { box, dbg };
}

function pickCropBoxGenericMeter(digitTokens: TokenBox[], imgW: number, imgH: number) {
  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { box: null as CropBox | null, dbg: { method: "no-clean" } };

  const bounds = docBounds(clean);
  const maxH = Math.max(...clean.map((t) => t.h));
  const minBigH = maxH * 0.65;

  const cands = clean
    .filter((t) => t.h >= minBigH)
    .filter((t) => t.digitLen >= 4 && t.digitLen <= 9)
    .map((t) => {
      const yNorm = clamp((t.cy - bounds.minY) / bounds.h, 0, 1);
      // evita pegar números da escala (muito no topo)
      const yOk = yNorm >= 0.20 && yNorm <= 0.92;
      return { t, yNorm, score: t.h * (1 + t.digitLen) * (yOk ? 1.15 : 0.9) };
    })
    .sort((a, b) => b.score - a.score);

  if (!cands.length) return { box: null as CropBox | null, dbg: { method: "no-cands", maxH, minBigH } };

  const main = cands[0].t;

  const spanX = main.w;
  const spanY = main.h;

  const marginL = Math.max(30, Math.floor(spanX * 0.45));
  const marginR = Math.max(40, Math.floor(spanX * 0.55));
  const marginT = Math.max(35, Math.floor(spanY * 2.2));
  const marginB = Math.max(35, Math.floor(spanY * 2.5));

  const left = clamp(Math.floor(main.minX - marginL), 0, imgW - 2);
  const top = clamp(Math.floor(main.minY - marginT), 0, imgH - 2);
  const right = clamp(Math.floor(main.maxX + marginR), left + 2, imgW);
  const bottom = clamp(Math.floor(main.maxY + marginB), top + 2, imgH);

  const box: CropBox = {
    left,
    top,
    width: Math.max(2, right - left),
    height: Math.max(2, bottom - top),
  };

  return {
    box,
    dbg: {
      method: "token",
      maxH,
      minBigH,
      picked: { text: main.text, digits: main.digits, h: main.h },
      box,
    },
  };
}

async function enhanceForDigits(buf: Buffer, targetMaxW = 1600) {
  const meta = await sharp(buf).metadata();
  const w = meta.width || 1;
  const h = meta.height || 1;

  // upscale 2x (limitado)
  const desiredW = Math.min(targetMaxW, Math.max(1, Math.floor(w * 2)));
  const desiredH = Math.max(1, Math.floor((desiredW * h) / w));

  return await sharp(buf)
    .rotate()
    .resize(desiredW, desiredH, { fit: "inside" })
    .grayscale()
    .normalize() // aumenta contraste global
    .sharpen(1.0)
    .toBuffer();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase().trim(); // horimetro | odometro | abastecimento
    const equip = (searchParams.get("equip") || "").trim();
    const url = (searchParams.get("url") || "").trim();

    if (!kind) return jsonError("Informe ?kind=horimetro|odometro|abastecimento", 400);
    if (!url) return jsonError("Informe ?url=<signed_url>", 400);

    // baixa imagem
    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Falha ao baixar imagem (signed url).", 400, { status: imgRes.status });
    }
    const rawBytes = new Uint8Array(await imgRes.arrayBuffer());

    // === base (orientada + resize) ===
    const base = await preprocessBaseImage(rawBytes);

    // === PASS 1 (full) ===
    const pass1 = await runVision(base.buf);

    // sempre fazemos crop + PASS 2 para abastecimento
    // e fazemos crop para horimetro/odometro quando for útil (aqui: sempre também, porque melhora muito)
    let pass2: Awaited<ReturnType<typeof runVision>> | null = null;
    let cropInfo: any = null;

    if (kind === "abastecimento" || kind === "horimetro" || kind === "odometro") {
      let cropPick:
        | { box: CropBox | null; dbg: any }
        | { box: CropBox | null; dbg: any };

      if (kind === "abastecimento") {
        cropPick = pickCropBoxAbastecimento(pass1.digitTokens, base.width, base.height);
      } else {
        cropPick = pickCropBoxGenericMeter(pass1.digitTokens, base.width, base.height);
      }

      if (cropPick.box) {
        const cropped = await sharp(base.buf)
          .extract(cropPick.box)
          .toBuffer();

        const enhanced = await enhanceForDigits(cropped, 1600);
        pass2 = await runVision(enhanced);

        cropInfo = {
          kind,
          crop_pick: cropPick.dbg,
          crop_box: cropPick.box,
          base_size: { w: base.width, h: base.height },
        };
      } else {
        cropInfo = { kind, crop_pick: cropPick.dbg, crop_box: null, base_size: { w: base.width, h: base.height } };
      }
    }

    // usa PASS 2 se existir (mais limpo), senão PASS 1
    const final = pass2 || pass1;

    const rawFull = final.rawFull;
    const digitTokens = final.digitTokens;

    if (!digitTokens.length) {
      return NextResponse.json({
        ok: true,
        kind,
        equip: equip || null,
        best: null,
        best_input: "",
        candidates: [],
        candidates_input: [],
        raw: rawFull,
        debug: {
          token_count: 0,
          note: "sem tokens com dígitos",
          crop: cropInfo,
          pass1_raw: pass1.rawFull?.slice(0, 220),
          pass2_raw: pass2?.rawFull?.slice(0, 220) || null,
        },
      });
    }

    let best: number | null = null;
    let best_input = "";
    let candidates: (number | null)[] = [];
    let candidates_input: string[] = [];

    let pickedDigits = "";
    let usedTokens: TokenBox[] = [];
    let pickedDebug: any = {};
    let extraMeta: any = {};

    if (kind === "horimetro") {
      const picked = pickHorimetroDigits(digitTokens);
      pickedDigits = picked.digits;
      usedTokens = picked.used;
      pickedDebug = picked.dbg;

      const parsed = parseHorimetro(pickedDigits);
      if (parsed) {
        best = parsed.value;
        best_input = parsed.best_input;
        candidates = [best];
        candidates_input = [best_input];
      } else {
        best = null;
      }
    } else if (kind === "abastecimento") {
      const picked = pickAbastecimentoDigits(digitTokens);
      pickedDigits = picked.digits;
      usedTokens = picked.used;
      pickedDebug = picked.dbg;

      const parsed = parseAbastecimento(pickedDigits);
      if (parsed) {
        best = parsed.value;
        best_input = parsed.best_input;
        candidates = [best];
        candidates_input = [best_input];
      } else {
        best = null;
      }
    } else if (kind === "odometro") {
      const picked = pickOdometroDigits(digitTokens);
      pickedDigits = picked.digits;
      usedTokens = picked.used;
      pickedDebug = picked.dbg;

      const parsed = parseOdometro(pickedDigits, usedTokens);
      if (parsed) {
        best = parsed.value;
        best_input = parsed.best_input;
        candidates = [best];
        candidates_input = [best_input];
        extraMeta.hasDecMark = parsed.hasDecMark;
      } else {
        best = null;
      }
    } else {
      return jsonError("kind inválido. Use horimetro, odometro ou abastecimento.", 400);
    }

    return NextResponse.json({
      ok: true,
      kind,
      equip: equip || null,
      best,
      best_input,
      candidates,
      candidates_input,
      raw: rawFull,
      debug: {
        token_count: digitTokens.length,
        picked_digits: pickedDigits,
        picked_strategy: pickedDebug?.method || null,
        picked_meta: pickedDebug || null,
        extra_meta: extraMeta,
        crop: cropInfo,
        pass1_raw: pass1.rawFull?.slice(0, 220),
        pass2_raw: pass2?.rawFull?.slice(0, 220) || null,
        used_tokens: usedTokens.map((t) => ({
          text: t.text,
          digits: t.digits,
          h: t.h,
          x: [t.minX, t.maxX],
          y: [t.minY, t.maxY],
        })),
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR.", 500);
  }
}

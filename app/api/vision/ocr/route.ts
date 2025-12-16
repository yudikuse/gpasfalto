import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

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

/**
 * Normaliza confusões clássicas do OCR em displays mecânicos:
 * O/○/D/Q -> 0
 * I/l/|/! -> 1
 * Z -> 2
 * S -> 5
 * G -> 6
 * T -> 7 (às vezes)
 * B -> 8
 */
function normalizeOcrText(s: string) {
  const x = (s || "").trim();
  if (!x) return "";
  return x
    .replace(/[Oo○°DQQ]/g, "0")
    .replace(/[Il|!]/g, "1")
    .replace(/[Z]/g, "2")
    .replace(/[Ss]/g, "5")
    .replace(/[G]/g, "6")
    .replace(/[T]/g, "7")
    .replace(/[B]/g, "8");
}

function digitsOf(s: string) {
  return normalizeOcrText(s || "").replace(/[^\d]/g, "");
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
    process.env.GCP_VISION_API_KEY ||
    process.env.GOOGLE_VISION_API_KEY ||
    "";

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
    .filter((t) => Math.abs(t.cy - mainCy) <= Math.max(10, mainH * 0.9))
    .filter((t) => t.minX >= main.maxX)
    .map((t) => {
      const gap = t.minX - main.maxX;
      return { t, gap };
    })
    .filter(({ gap }) => gap >= 0 && gap <= Math.max(60, mainH * 3.5))
    .sort((a, b) => a.gap - b.gap);

  return candidates[0]?.t || null;
}

/**
 * HORÍMETRO (mantido como estava, mas agora beneficia da normalização OCR)
 */
function pickHorimetroDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length)
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };

  const clean = digitTokens.filter((t) => t.digitLen > 0);
  if (!clean.length)
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);
  const maxH = Math.max(...clean.map((t) => t.h));
  const minBigH = maxH * 0.7;

  const longTokens = clean
    .filter((t) => t.h >= minBigH)
    .filter((t) => t.digitLen >= 4 && t.digitLen <= 6)
    .sort((a, b) => {
      if (b.h !== a.h) return b.h - a.h;
      return b.digitLen - a.digitLen;
    });

  if (longTokens.length) {
    const main = longTokens[0];
    let digits = main.digits;

    if (digits.length === 4) {
      const dec = findDecimalRight(main, clean);
      if (dec) digits = digits + dec.digits;
      dbg.decFound = !!dec;
    }

    dbg.method = "long-token";
    dbg.maxH = maxH;
    dbg.minBigH = minBigH;
    dbg.bounds = { w: bounds.w, h: bounds.h };

    const used: TokenBox[] = [main];
    if (dbg.decFound) {
      const dec = findDecimalRight(main, clean);
      if (dec) used.push(dec);
    }

    return { digits, used, dbg };
  }

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
    .filter((c) => c.m.spanNorm <= 0.62 && c.m.compactness <= 3.4 && c.m.maxGap <= c.m.avgW * 3.0)
    .map((c) => ({
      ...c,
      score:
        c.r.avgH *
        (1 + c.digits.length) *
        (1 + c.yNorm * 0.35) /
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

  if (digits.length === 4) {
    const main = picked.strong[picked.strong.length - 1];
    const dec = main ? findDecimalRight(main, clean) : null;
    if (dec) digits = digits + dec.digits;
    dbg.decFound = !!dec;
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

  const used = [...picked.strong];
  if (dbg.decFound) {
    const main = picked.strong[picked.strong.length - 1];
    const dec = main ? findDecimalRight(main, clean) : null;
    if (dec) used.push(dec);
  }

  return { digits, used, dbg };
}

function parseHorimetro(digits: string) {
  const d = digitsOf(digits);
  if (d.length < 4) return null;

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
 * ABASTECIMENTO (NOVO – baseado no “aprendizado” pelas fotos):
 * - números grandes do visor = uma LINHA com 3 ou 4 dígitos (decimal é o último)
 * - ignorar contador pequeno (normalmente 6–8 dígitos) -> drop por regra de tamanho
 * - escolher a linha “larga” (maior spanX) + mais acima (yNorm menor)
 * - se vier só 3 dígitos, tenta achar 1 dígito à direita (decimal); senão padStart(4)
 */
function pickAbastecimentoDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length)
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };

  // NÃO filtra por letras: já normalizamos e extraímos dígitos (isso era o motivo do “nada”)
  const clean = digitTokens.filter((t) => t.digitLen > 0);
  if (!clean.length)
    return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);
  const rows = clusterRows(clean);

  type Cand = {
    row: Row;
    used: TokenBox[];
    digitsRaw: string;
    digitsFinal: string;
    yNorm: number;
    spanNorm: number;
    avgH: number;
    score: number;
  };

  const cands: Cand[] = [];

  for (const r of rows) {
    // remove tokens que não fazem sentido pro visor grande (ex.: contador embaixo inteiro ou ruído longo)
    // deixa no máximo tokens de até 3 dígitos (ex.: "150") e 1 dígito (decimal)
    const local = r.items.filter((t) => t.digitLen > 0 && t.digitLen <= 3);
    if (!local.length) continue;

    const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

    // regra forte: contador pequeno embaixo geralmente está “bem abaixo”.
    // 0.62 funcionou melhor que 0.82 nos seus exemplos.
    if (yNorm > 0.62) continue;

    // monta sequência na ordem X
    const seq = [...local].sort((a, b) => a.minX - b.minX);
    let digitsRaw = seq.map((t) => t.digits).join("");
    digitsRaw = digitsOf(digitsRaw);

    // o visor grande precisa virar 4 dígitos no final (ex.: 0310 => 31,0)
    // aceitamos 3 ou 4 na leitura primária; o resto é quase sempre contador/ruído
    if (!(digitsRaw.length === 3 || digitsRaw.length === 4)) continue;

    // tenta completar decimal se veio só 3
    let used = [...seq];
    let digitsFinal = digitsRaw;

    if (digitsFinal.length === 3) {
      const rightMost = seq[seq.length - 1];
      const dec = rightMost ? findDecimalRight(rightMost, clean) : null;
      if (dec) {
        digitsFinal = digitsFinal + dec.digits;
        used.push(dec);
      }
    }

    // se ainda ficou 3 (decimal não veio), padStart (ex.: "265" => "0265")
    if (digitsFinal.length === 3) digitsFinal = digitsFinal.padStart(4, "0");

    // se excedeu (caso raro de duplicar), garante 4 com últimos 4
    if (digitsFinal.length > 4) digitsFinal = digitsFinal.slice(-4);

    if (digitsFinal.length !== 4) continue;

    const m = compactnessMetrics(seq, bounds.w);
    const spanNorm = m.spanNorm;

    // Score: privilegia linha “larga” (visor grande ocupa muita largura) e mais acima
    // também ajuda a ignorar token isolado tipo "091" quando existe a linha real.
    const score = (spanNorm * 2.2 + 0.25) * (r.avgH + 1) * (1.15 - yNorm * 0.45);

    // regra de confiança: se for “estreito demais”, provavelmente é lixo/contador parcial
    // (ajuda a evitar puxar 9,1 quando não enxergou o visor real)
    if (spanNorm < 0.16) continue;

    cands.push({
      row: r,
      used,
      digitsRaw,
      digitsFinal,
      yNorm,
      spanNorm,
      avgH: r.avgH,
      score,
    });
  }

  cands.sort((a, b) => b.score - a.score);

  dbg.method = "row-wide";
  dbg.bounds = { w: bounds.w, h: bounds.h };
  dbg.top = cands.slice(0, 10).map((c) => ({
    digitsRaw: c.digitsRaw,
    digitsFinal: c.digitsFinal,
    score: c.score,
    yNorm: c.yNorm,
    spanNorm: c.spanNorm,
    avgH: c.avgH,
  }));

  if (!cands.length) {
    // fallback bem conservador: tenta qualquer token 4 dígitos “sozinho” que seja relativamente largo
    const tok = clean
      .filter((t) => t.digitLen === 4 || t.digitLen === 3)
      .map((t) => {
        const yNorm = clamp((t.cy - bounds.minY) / bounds.h, 0, 1);
        const spanNorm = clamp(t.w / bounds.w, 0, 1);
        return { t, yNorm, spanNorm };
      })
      .filter((x) => x.yNorm <= 0.62 && x.spanNorm >= 0.16)
      .sort((a, b) => {
        if (b.spanNorm !== a.spanNorm) return b.spanNorm - a.spanNorm;
        return a.yNorm - b.yNorm;
      })[0]?.t;

    if (!tok) return { digits: "", used: [], dbg: { ...dbg, method: "no-cands" } };

    let d = tok.digits;
    if (d.length === 3) d = d.padStart(4, "0");
    if (d.length > 4) d = d.slice(-4);

    return { digits: d, used: [tok], dbg: { ...dbg, method: "fallback-token" } };
  }

  const picked = cands[0];
  return { digits: picked.digitsFinal, used: picked.used, dbg };
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

async function visionTextDetection(imageBytes: Uint8Array) {
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
    throw new Error(
      `Vision API falhou: HTTP ${res.status} - ${JSON.stringify(data)?.slice(0, 500)}`,
    );
  }
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase().trim(); // "horimetro" | "abastecimento"
    const equip = (searchParams.get("equip") || "").trim();
    const url = (searchParams.get("url") || "").trim();

    if (!kind) return jsonError("Informe ?kind=horimetro|abastecimento", 400);
    if (!url) return jsonError("Informe ?url=<signed_url>", 400);

    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Falha ao baixar imagem (signed url).", 400, { status: imgRes.status });
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());

    const vision = await visionTextDetection(buf);
    const resp0 = vision?.responses?.[0] || {};
    const textAnnotations: VisionAnnot[] = resp0?.textAnnotations || [];

    const rawFull = (textAnnotations?.[0]?.description || "").trim();

    const tokens: TokenBox[] = (textAnnotations || [])
      .slice(1)
      .map(polyToBox)
      .filter(Boolean) as TokenBox[];

    const digitTokens = tokens.filter((t) => t.digitLen > 0);

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
        debug: { token_count: 0, note: "sem tokens com dígitos" },
      });
    }

    let best: number | null = null;
    let best_input = "";
    let candidates: (number | null)[] = [];
    let candidates_input: string[] = [];

    let pickedDigits = "";
    let usedTokens: TokenBox[] = [];
    let pickedDebug: any = {};

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
    } else {
      return jsonError("kind inválido. Use horimetro ou abastecimento.", 400);
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

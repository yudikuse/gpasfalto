// FILE: app/api/vision/ocr/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Vertex = { x?: number; y?: number };
type BBox = { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; w: number; h: number };

type Sym = {
  ch: string;
  box: BBox;
  // referência pra debug
  path?: string;
};

function json(ok: boolean, payload: any, status = 200) {
  return NextResponse.json({ ok, ...payload }, { status });
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let tokenCache: { token: string; expMs: number } | null = null;

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expMs - 60_000) return tokenCache.token;

  const saB64 = process.env.GCP_SA_KEY_BASE64 || process.env.GCP_KEY_BASE64 || "";
  if (!saB64) throw new Error("Env GCP_SA_KEY_BASE64/GCP_KEY_BASE64 não configurada.");

  const sa = JSON.parse(Buffer.from(saB64, "base64").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: sa.private_key_id,
  };

  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = signer.sign(sa.private_key);

  const jwt = `${unsigned}.${b64url(sig)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`OAuth: ${data?.error_description || data?.error || "falha"}`);
  }

  tokenCache = {
    token: data.access_token,
    expMs: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };

  return tokenCache.token;
}

async function callVision(imageBytes: Buffer) {
  const token = await getAccessToken();

  const body = {
    requests: [
      {
        image: { content: imageBytes.toString("base64") },
        features: [
          { type: "DOCUMENT_TEXT_DETECTION" },
          { type: "TEXT_DETECTION" },
        ],
        imageContext: {
          languageHints: ["pt", "en"],
          textDetectionParams: { enableTextDetectionConfidenceScore: true },
        },
      },
    ],
  };

  const r = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const j = await r.json();
  if (!r.ok) {
    throw new Error(`Vision: ${JSON.stringify(j)?.slice(0, 300)}`);
  }

  return j?.responses?.[0] || {};
}

function bboxFrom(vertices: Vertex[] | undefined): BBox | null {
  if (!vertices?.length) return null;
  const xs = vertices.map(v => Number(v.x || 0));
  const ys = vertices.map(v => Number(v.y || 0));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { minX, minY, maxX, maxY, w, h, cx: minX + w / 2, cy: minY + h / 2 };
}

function extractSymbols(doc: any): Sym[] {
  const out: Sym[] = [];
  const pages = doc?.pages || [];
  for (let pi = 0; pi < pages.length; pi++) {
    const blocks = pages[pi]?.blocks || [];
    for (let bi = 0; bi < blocks.length; bi++) {
      const paras = blocks[bi]?.paragraphs || [];
      for (let pai = 0; pai < paras.length; pai++) {
        const words = paras[pai]?.words || [];
        for (let wi = 0; wi < words.length; wi++) {
          const syms = words[wi]?.symbols || [];
          for (let si = 0; si < syms.length; si++) {
            const ch = String(syms[si]?.text || "");
            const box = bboxFrom(syms[si]?.boundingBox?.vertices);
            if (!ch || !box) continue;
            out.push({ ch, box, path: `p${pi}b${bi}p${pai}w${wi}s${si}` });
          }
        }
      }
    }
  }
  return out;
}

function median(nums: number[]) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

type Group = {
  digits: string;          // só dígitos (0-9)
  minX: number; minY: number; maxX: number; maxY: number;
  cx: number; cy: number;
  h: number; w: number;
  size: number;            // “tamanho” (altura mediana dos dígitos)
  syms: Sym[];
};

function buildGroups(symbols: Sym[]) {
  const digitSyms = symbols.filter(s => /^[0-9]$/.test(s.ch));

  // tamanho global (pra debug / thresholds)
  let maxX = 0, maxY = 0;
  for (const s of symbols) {
    maxX = Math.max(maxX, s.box.maxX);
    maxY = Math.max(maxY, s.box.maxY);
  }

  // 1) agrupa por “linha” (y parecido)
  const sorted = [...digitSyms].sort((a, b) => a.box.cy - b.box.cy);
  const lines: Sym[][] = [];
  const lineY: number[] = [];
  const lineTol: number[] = [];

  for (const s of sorted) {
    const tol = Math.max(8, s.box.h * 0.8);
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (Math.abs(s.box.cy - lineY[i]) <= Math.max(lineTol[i], tol)) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      lines.push([s]);
      lineY.push(s.box.cy);
      lineTol.push(tol);
    } else {
      lines[idx].push(s);
      // atualiza centro da linha “suavemente”
      lineY[idx] = (lineY[idx] * 0.7) + (s.box.cy * 0.3);
      lineTol[idx] = Math.max(lineTol[idx], tol);
    }
  }

  // 2) dentro de cada linha, separa em “grupos contíguos” por gap no X
  const groups: Group[] = [];

  for (const line of lines) {
    const byX = [...line].sort((a, b) => a.box.cx - b.box.cx);
    if (!byX.length) continue;

    const heights = byX.map(s => s.box.h);
    const hMed = median(heights);
    const gaps: number[] = [];
    for (let i = 1; i < byX.length; i++) gaps.push(byX[i].box.minX - byX[i - 1].box.maxX);
    const gapMed = median(gaps);

    const chunks: Sym[][] = [];
    let cur: Sym[] = [byX[0]];

    for (let i = 1; i < byX.length; i++) {
      const prev = byX[i - 1];
      const curSym = byX[i];
      const gap = curSym.box.minX - prev.box.maxX;

      // quebra quando tem “buraco” grande (evita juntar números do painel)
      const breakByGap = gap > Math.max(hMed * 1.2, gapMed * 2.5, 18);
      if (breakByGap) {
        chunks.push(cur);
        cur = [curSym];
      } else {
        cur.push(curSym);
      }
    }
    chunks.push(cur);

    for (const chunk of chunks) {
      const digits = chunk.map(s => s.ch).join("");
      if (!digits) continue;

      let minX = Infinity, minY = Infinity, maxX2 = -Infinity, maxY2 = -Infinity;
      for (const s of chunk) {
        minX = Math.min(minX, s.box.minX);
        minY = Math.min(minY, s.box.minY);
        maxX2 = Math.max(maxX2, s.box.maxX);
        maxY2 = Math.max(maxY2, s.box.maxY);
      }

      const w = Math.max(1, maxX2 - minX);
      const h = Math.max(1, maxY2 - minY);

      groups.push({
        digits,
        minX, minY, maxX: maxX2, maxY: maxY2,
        cx: minX + w / 2,
        cy: minY + h / 2,
        w, h,
        size: median(chunk.map(s => s.box.h)),
        syms: chunk,
      });
    }
  }

  return { groups, maxX, maxY };
}

function formatOneDecimal(n: number) {
  // sem milhares, sempre 1 casa decimal, vírgula pt-BR
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const intPart = Math.floor(abs);
  const dec = Math.round((abs - intPart) * 10);
  return `${sign}${intPart},${dec}`;
}

function pickDecimalDigitRightOf(groups: Group[], main: Group) {
  // procura um grupo de 1 dígito na mesma altura, à direita do “main”
  const sameLine = groups
    .filter(g =>
      g.digits.length === 1 &&
      Math.abs(g.cy - main.cy) <= Math.max(12, main.size * 0.9) &&
      g.minX > main.maxX &&
      (g.minX - main.maxX) < Math.max(60, main.size * 4)
    )
    .sort((a, b) => (a.minX - main.maxX) - (b.minX - main.maxX));

  if (!sameLine.length) return null;
  return sameLine[0].digits; // um dígito
}

function parseHorimetro(groups: Group[], imgH: number) {
  // filtra grupos “bons” (evita RPM x 100, 70, 60, 110 etc)
  const candidates = groups
    .filter(g => g.digits.length >= 4)
    .filter(g => g.cy > imgH * 0.30) // prioriza parte de baixo
    .map(g => {
      // score: mais dígitos + maior + mais embaixo
      const score = (g.digits.length * 120) + (g.size * 2) + (g.cy / imgH) * 10;
      return { g, score };
    })
    .sort((a, b) => b.score - a.score);

  const main = candidates[0]?.g || null;
  if (!main) return { best: null as number | null, bestInput: null as string | null, picked: null as any };

  // tenta achar decimal à direita (normal no horímetro)
  let digits = main.digits;
  let dec: string | null = null;

  // se já veio com 6+ dígitos, assume “último = decimal”
  if (digits.length >= 6) {
    dec = digits.slice(-1);
    digits = digits.slice(0, -1);
  } else {
    dec = pickDecimalDigitRightOf(groups, main);
  }

  const intVal = parseInt(digits, 10);
  const decVal = dec ? parseInt(dec, 10) : 0;

  const value = intVal + (decVal / 10);
  return { best: value, bestInput: formatOneDecimal(value), picked: { main: main.digits, dec } };
}

function parseLitros(groups: Group[]) {
  // litros: pega o grupo de dígitos “mais grande” (contador grande)
  const candidates = groups
    .filter(g => g.digits.length >= 3)
    .map(g => {
      const score = (g.size * 10) + (g.digits.length * 50) + (g.w * 0.02);
      return { g, score };
    })
    .sort((a, b) => b.score - a.score);

  const main = candidates[0]?.g || null;
  if (!main) return { best: null as number | null, bestInput: null as string | null, picked: null as any };

  let digits = main.digits;
  let dec: string | null = null;

  // regra: último dígito é a casa decimal (1146 => 114,6 / 0310 => 31,0)
  if (digits.length >= 4) {
    dec = digits.slice(-1);
    digits = digits.slice(0, -1);
  } else {
    // 3 dígitos: tenta achar decimal à direita (se existir)
    dec = pickDecimalDigitRightOf(groups, main) || "0";
  }

  const intVal = parseInt(digits, 10);
  const decVal = parseInt(dec, 10);

  const value = intVal + (decVal / 10);
  return { best: value, bestInput: formatOneDecimal(value), picked: { main: main.digits, dec } };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get("kind") || "horimetro").toLowerCase();
    const url = searchParams.get("url") || "";

    if (!url) return json(false, { error: "Parâmetro 'url' é obrigatório." }, 400);

    const imgResp = await fetch(url, { cache: "no-store" });
    if (!imgResp.ok) {
      return json(false, { error: `Falha ao baixar imagem: ${imgResp.status}` }, 400);
    }
    const bytes = Buffer.from(await imgResp.arrayBuffer());

    const vision = await callVision(bytes);

    const fullText =
      vision?.fullTextAnnotation?.text ||
      vision?.textAnnotations?.[0]?.description ||
      "";

    const symbols = extractSymbols(vision?.fullTextAnnotation);

    const { groups, maxX, maxY } = buildGroups(symbols);

    let best: number | null = null;
    let best_input: string | null = null;
    let picked: any = null;

    if (kind === "abastecimento" || kind === "litros") {
      const r = parseLitros(groups);
      best = r.best;
      best_input = r.bestInput;
      picked = r.picked;
    } else {
      const r = parseHorimetro(groups, maxY || 1000);
      best = r.best;
      best_input = r.bestInput;
      picked = r.picked;
    }

    // candidatos pra debug (top 8)
    const candidates = groups
      .sort((a, b) => b.size - a.size)
      .slice(0, 8)
      .map(g => g.digits);

    return json(true, {
      kind,
      best,
      best_input,
      raw: fullText,
      debug: {
        token_count: symbols.length,
        group_count: groups.length,
        candidates,
        picked,
        maxX,
        maxY,
      },
    });
  } catch (e: any) {
    return json(false, { error: e?.message || "Erro inesperado." }, 500);
  }
}

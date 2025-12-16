// FILE: app/api/vision/ocr/route.ts
import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Vertex = { x?: number; y?: number };
type BoundingPoly = { vertices?: Vertex[] };
type TextAnnotation = { description?: string; boundingPoly?: BoundingPoly };

type VisionResponse = {
  textAnnotations?: TextAnnotation[];
  fullTextAnnotation?: { text?: string };
  error?: { message?: string };
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

function onlyDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function formatPt1(value: number) {
  // 1 casa decimal com vírgula
  return value.toFixed(1).replace(".", ",");
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function bboxFromVertices(vertices?: Vertex[]) {
  const vs = vertices || [];
  const xs = vs.map((v) => (typeof v.x === "number" ? v.x : 0));
  const ys = vs.map((v) => (typeof v.y === "number" ? v.y : 0));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 0;
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function pickBestNumericWord(
  annos: TextAnnotation[],
  opts: { minDigits: number; maxDigits: number; imgH: number }
) {
  // ignora o [0] porque geralmente é o texto completo
  let best: { a: TextAnnotation; score: number; digits: string; bbox: any } | null = null;

  for (let i = 1; i < annos.length; i++) {
    const a = annos[i];
    const desc = a.description || "";
    const digits = onlyDigits(desc);
    if (!digits) continue;
    if (digits.length < opts.minDigits || digits.length > opts.maxDigits) continue;

    const bbox = bboxFromVertices(a.boundingPoly?.vertices);
    if (!bbox.h || !bbox.w) continue;

    // prefere o que é maior (normalmente o visor principal)
    // e mais “alto na imagem” (topo), porque a linha de baixo (odômetro) é pequena
    const centerY = bbox.minY + bbox.h / 2;
    const topBias = Math.max(0, 1 - centerY / Math.max(1, opts.imgH)); // 0..1
    const score = bbox.h * 1000 + bbox.w * 2 + topBias * 200;

    if (!best || score > best.score) best = { a, score, digits, bbox };
  }

  return best;
}

let cachedToken: { token: string; expMs: number } | null = null;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expMs) return cachedToken.token;

  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";

  if (!b64) throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) não configurada.");

  const saJson = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

  const auth = new GoogleAuth({
    credentials: saJson,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"]
  });

  const client = await auth.getClient();
  const tokResp = await client.getAccessToken();
  const token = typeof tokResp === "string" ? tokResp : tokResp?.token;

  if (!token) throw new Error("Falha ao obter access_token do Google.");

  // cache simples ~45 min
  cachedToken = { token, expMs: Date.now() + 45 * 60 * 1000 };
  return token;
}

async function visionAnnotateBatch(imagesBase64: string[], featureType: "TEXT_DETECTION" | "DOCUMENT_TEXT_DETECTION") {
  const token = await getAccessToken();

  const body = {
    requests: imagesBase64.map((content) => ({
      image: { content },
      features: [{ type: featureType, maxResults: 10 }],
      imageContext: { languageHints: ["en"] }
    }))
  };

  const r = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  const json = await r.json().catch(() => null);

  if (!r.ok) {
    const msg = json?.error?.message || `HTTP ${r.status}`;
    throw new Error(`Vision API: ${msg}`);
  }

  const responses: VisionResponse[] = json?.responses || [];
  return responses;
}

async function cropBuffer(buf: Buffer, left: number, top: number, width: number, height: number, preprocess = true) {
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;

  let s = sharp(buf).extract({ left, top, width, height });

  if (preprocess) {
    // melhora contraste p/ visor mecânico
    s = s.grayscale().normalize().sharpen();
  }

  return await s.toBuffer();
}

function pickSingleDigitFromVision(resp: VisionResponse) {
  const t = resp?.textAnnotations?.[0]?.description || resp?.fullTextAnnotation?.text || "";
  const m = t.match(/[0-9]/);
  return m ? m[0] : null;
}

async function handleHorimetro(imgBuf: Buffer, imgW: number, imgH: number, first: VisionResponse) {
  const annos = first.textAnnotations || [];
  const picked = pickBestNumericWord(annos, { minDigits: 4, maxDigits: 6, imgH });

  const raw = first.fullTextAnnotation?.text || annos?.[0]?.description || "";

  // fallback simples
  if (!picked) {
    const digits = onlyDigits(raw);
    const main = digits ? parseInt(digits, 10) : null;
    const best = main !== null ? main : null;
    return {
      best,
      best_input: best !== null ? formatPt1(best) : "",
      candidates: best !== null ? [best] : [],
      candidates_input: best !== null ? [formatPt1(best)] : [],
      raw,
      debug: { note: "no-picked-word" }
    };
  }

  const mainDigits = picked.digits.replace(/^0+/, "") || "0";
  const main = parseInt(mainDigits, 10);

  // tenta ler a casa decimal recortando uma “janela” à direita do grupo principal
  const padY = Math.round(picked.bbox.h * 0.25);
  const padX = Math.round(picked.bbox.w * 0.08);

  const decLeft = clampInt(picked.bbox.maxX + padX, 0, imgW - 1);
  const decTop = clampInt(picked.bbox.minY - padY, 0, imgH - 1);
  const decWidth = clampInt(Math.round(picked.bbox.w * 0.30), 20, imgW - decLeft);
  const decHeight = clampInt(picked.bbox.h + padY * 2, 20, imgH - decTop);

  let decDigit: string | null = null;
  try {
    const decCrop = await cropBuffer(imgBuf, decLeft, decTop, decWidth, decHeight, true);
    const decB64 = decCrop.toString("base64");
    const [resp] = await visionAnnotateBatch([decB64], "TEXT_DETECTION");
    decDigit = pickSingleDigitFromVision(resp);
  } catch {
    decDigit = null;
  }

  const dec = decDigit ? parseInt(decDigit, 10) : 0;
  const best = main + dec / 10;

  return {
    best,
    best_input: formatPt1(best),
    candidates: [best],
    candidates_input: [formatPt1(best)],
    raw,
    debug: {
      picked_main: picked.digits,
      decDigit: decDigit ?? null,
      decCrop: { decLeft, decTop, decWidth, decHeight }
    }
  };
}

async function handleAbastecimento(imgBuf: Buffer, imgW: number, imgH: number, first: VisionResponse) {
  const annos = first.textAnnotations || [];
  const raw = first.fullTextAnnotation?.text || annos?.[0]?.description || "";

  const picked = pickBestNumericWord(annos, { minDigits: 2, maxDigits: 4, imgH });

  // fallback simples
  if (!picked) {
    const digits = onlyDigits(raw);
    // tenta 4 dígitos (xxxD)
    const d4 = digits.length >= 4 ? digits.slice(0, 4) : digits;
    if (d4.length >= 2) {
      const main = parseInt(d4.slice(0, -1) || "0", 10);
      const dec = parseInt(d4.slice(-1), 10);
      const best = main + dec / 10;
      return {
        best,
        best_input: formatPt1(best),
        candidates: [best],
        candidates_input: [formatPt1(best)],
        raw,
        debug: { note: "fallback-raw", digits }
      };
    }
    return { best: null, best_input: "", candidates: [], candidates_input: [], raw, debug: { note: "no-digits" } };
  }

  // recorte baseado no melhor “word” numérico (normalmente 3 dígitos grandes)
  // e EXPANDE para a direita para incluir o 4º dígito (decimal), que às vezes o OCR não pega.
  const padY = Math.round(picked.bbox.h * 0.35);
  const padX = Math.round(picked.bbox.w * 0.06);

  const left = clampInt(picked.bbox.minX - padX, 0, imgW - 1);
  const top = clampInt(picked.bbox.minY - padY, 0, imgH - 1);

  const extraRight = Math.round(picked.bbox.w * 0.45); // espaço pro dígito decimal
  const width = clampInt(picked.bbox.w + padX * 2 + extraRight, 40, imgW - left);
  const height = clampInt(picked.bbox.h + padY * 2, 30, imgH - top);

  // 1) recorta visor
  const visor = await cropBuffer(imgBuf, left, top, width, height, true);

  // 2) divide em 4 janelas e OCR por dígito (batch)
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;

  const segW = Math.floor(width / 4);
  const segH = height;

  const segs: Buffer[] = [];
  for (let i = 0; i < 4; i++) {
    const segLeft = i * segW;
    const w = i === 3 ? width - segLeft : segW;

    // margenzinha interna pra não pegar borda do visor
    const innerPad = Math.max(1, Math.round(w * 0.06));
    const innerTop = Math.max(0, Math.round(segH * 0.08));
    const innerH = Math.max(10, segH - innerTop * 2);

    const seg = await sharp(visor)
      .extract({
        left: clampInt(segLeft + innerPad, 0, width - 1),
        top: clampInt(innerTop, 0, segH - 1),
        width: clampInt(w - innerPad * 2, 10, width - segLeft),
        height: clampInt(innerH, 10, segH - innerTop)
      })
      .grayscale()
      .normalize()
      .sharpen()
      .toBuffer();

    segs.push(seg);
  }

  const segB64 = segs.map((b) => b.toString("base64"));
  const segResps = await visionAnnotateBatch(segB64, "TEXT_DETECTION");
  const digits = segResps.map((r) => pickSingleDigitFromVision(r));

  // monta xxxx (onde o 4º é decimal)
  const d0 = digits[0] ?? "";
  const d1 = digits[1] ?? "";
  const d2 = digits[2] ?? "";
  const d3 = digits[3] ?? "";

  const assembled = `${d0}${d1}${d2}${d3}`.replace(/[^\d]/g, "");

  let best: number | null = null;

  if (assembled.length === 4) {
    const main = parseInt(assembled.slice(0, 3), 10);
    const dec = parseInt(assembled.slice(3), 10);
    best = main + dec / 10;
  } else {
    // fallback: tenta usar o que veio do OCR da linha (ex: "091" -> assume "0910")
    const norm = (picked.digits || "").padStart(3, "0") + "0";
    const main = parseInt(norm.slice(0, 3), 10);
    const dec = parseInt(norm.slice(3), 10);
    best = main + dec / 10;
  }

  return {
    best,
    best_input: best !== null ? formatPt1(best) : "",
    candidates: best !== null ? [best] : [],
    candidates_input: best !== null ? [formatPt1(best)] : [],
    raw,
    debug: {
      picked_line: picked.digits,
      crop: { left, top, width, height },
      digit_windows: digits,
      assembled
    }
  };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase();
    const equip = searchParams.get("equip") || null;
    const url = searchParams.get("url") || "";

    if (!kind || (kind !== "horimetro" && kind !== "abastecimento")) {
      return jsonError("kind inválido. Use horimetro ou abastecimento.", 400);
    }
    if (!url || !/^https?:\/\//i.test(url)) {
      return jsonError("url inválida.", 400);
    }

    const imgResp = await fetch(url, { cache: "no-store" });
    if (!imgResp.ok) {
      return jsonError(`Falha ao baixar imagem: HTTP ${imgResp.status}`, 400);
    }

    const arr = await imgResp.arrayBuffer();
    const imgBuf = Buffer.from(arr);

    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const meta = await sharp(imgBuf).metadata();
    const imgW = meta.width || 0;
    const imgH = meta.height || 0;

    const base64 = imgBuf.toString("base64");
    const [first] = await visionAnnotateBatch([base64], "DOCUMENT_TEXT_DETECTION");

    if (first?.error?.message) {
      return jsonError(`Vision error: ${first.error.message}`, 500, { kind, equip });
    }

    const result =
      kind === "horimetro"
        ? await handleHorimetro(imgBuf, imgW, imgH, first)
        : await handleAbastecimento(imgBuf, imgW, imgH, first);

    return NextResponse.json({
      ok: true,
      kind,
      equip,
      best: result.best,
      best_input: result.best_input,
      candidates: result.candidates,
      candidates_input: result.candidates_input,
      raw: result.raw,
      debug: {
        imgW,
        imgH,
        ...result.debug
      }
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR.", 500);
  }
}

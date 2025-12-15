import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

function b64url(input: Buffer | string) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// ===== Service Account -> Access Token (sem libs) =====
type TokenCache = { token: string; expMs: number };
let tokenCache: TokenCache | null = null;

function getServiceAccount() {
  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 ||
    "";

  if (!b64) throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) não configurada.");

  let creds: any;
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    creds = JSON.parse(json);
  } catch {
    throw new Error("Env GCP_SA_KEY_BASE64 inválida (esperado JSON em base64).");
  }

  if (!creds?.client_email || !creds?.private_key) {
    throw new Error("Service Account inválida: faltando client_email/private_key.");
  }

  return creds;
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expMs - now > 60_000) return tokenCache.token;

  const sa = getServiceAccount();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(data);
  sign.end();
  const signature = sign.sign(sa.private_key);
  const assertion = `${data}.${b64url(signature)}`;

  const body = new URLSearchParams();
  body.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  body.set("assertion", assertion);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  const j = await r.json().catch(() => null);

  if (!r.ok) {
    throw new Error(`Falha ao obter token OAuth: ${j?.error || r.status}`);
  }

  const token = j?.access_token as string;
  const expiresIn = Number(j?.expires_in || 3600);
  if (!token) throw new Error("Token OAuth vazio.");

  tokenCache = { token, expMs: now + expiresIn * 1000 };
  return token;
}

// ===== OCR (Vision REST) =====
async function visionTextDetection(imageBytes: Buffer) {
  const token = await getAccessToken();
  const content = imageBytes.toString("base64");

  const payload = {
    requests: [
      {
        image: { content },
        features: [{ type: "TEXT_DETECTION", maxResults: 50 }],
        imageContext: { languageHints: ["pt"] },
      },
    ],
  };

  const r = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Vision API erro: ${j?.error?.message || r.status}`);

  const resp0 = j?.responses?.[0] || {};
  const textAnnotations = resp0?.textAnnotations || [];
  return { raw: textAnnotations?.[0]?.description || "", anns: textAnnotations };
}

// ===== Candidatos / heurística =====
function getBoxCenterY(ann: any): number | null {
  const vs = ann?.boundingPoly?.vertices;
  if (!Array.isArray(vs) || vs.length === 0) return null;
  const ys = vs.map((v: any) => (typeof v?.y === "number" ? v.y : null)).filter((y: any) => y != null);
  if (!ys.length) return null;
  return ys.reduce((s: number, y: number) => s + y, 0) / ys.length;
}

function computeYRange(anns: any[]) {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const a of anns) {
    const vs = a?.boundingPoly?.vertices;
    if (!Array.isArray(vs)) continue;
    for (const v of vs) {
      if (typeof v?.y === "number") {
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  }

  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || maxY <= minY) return null;
  return { minY, maxY };
}

function normalizeCandidate(input: string): { input: string; value: number; hasDecimal: boolean } | null {
  let s = (input || "").trim();
  if (!s) return null;

  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const sep = Math.max(lastComma, lastDot);

  let hasDecimal = false;

  if (sep !== -1) {
    const decLen = s.length - sep - 1;
    if (decLen >= 1 && decLen <= 2) {
      hasDecimal = true;
      const intPart = s.slice(0, sep).replace(/[.,]/g, "");
      const decPart = s.slice(sep + 1).replace(/[.,]/g, "");
      const n = Number.parseFloat(`${intPart}.${decPart}`);
      if (!Number.isFinite(n)) return null;
      return { input: `${intPart},${decPart}`, value: n, hasDecimal };
    }
  }

  const intPart = s.replace(/[.,]/g, "");
  const n = Number.parseFloat(intPart);
  if (!Number.isFinite(n)) return null;
  return { input: intPart, value: n, hasDecimal: false };
}

function extractCandidatesFromText(raw: string): string[] {
  const out: string[] = [];
  const re = /(\d[\d.,]{0,10})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw || ""))) {
    const v = (m[1] || "").trim();
    if (v) out.push(v);
  }
  return out;
}

async function getLastHorimetroByEquip(equipamento: string): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!url || !key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const tables = ["equipament_hours", "equipment_hours"];

  for (const t of tables) {
    const { data, error } = await supabase
      .from(t)
      .select("horimetro,ano,mes,equipamento")
      .eq("equipamento", equipamento)
      .order("ano", { ascending: false })
      .order("mes", { ascending: false })
      .limit(1);

    if (!error && data && data.length) {
      const v = Number(data[0]?.horimetro);
      if (Number.isFinite(v)) return v;
    }
  }

  return null;
}

function pickBest(
  kind: string,
  items: Array<{ input: string; value: number; hasDecimal: boolean; centerY: number | null }>,
  yRange: { minY: number; maxY: number } | null,
  refHor: number | null
) {
  if (!items.length) return null;

  // se existe candidato grande, ignora pequenos (mata o "100" do RPM x 100)
  const hasBig = items.some((c) => c.value >= 500);
  let filtered = items.slice();
  if (kind === "horimetro" && hasBig) {
    filtered = filtered.filter((c) => c.value > 200);
  }

  // filtros por tipo
  if (kind === "abastecimento") {
    filtered = filtered.filter((c) => c.value > 0 && c.value < 1000);
  } else if (kind === "horimetro") {
    filtered = filtered.filter((c) => c.value >= 0 && c.value < 500000);
  }

  if (!filtered.length) filtered = items.slice();

  let best = filtered[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const c of filtered) {
    let score = 0;

    // posição: puxa pro "contador" (normalmente mais embaixo)
    if (yRange && c.centerY != null) {
      const rel = (c.centerY - yRange.minY) / (yRange.maxY - yRange.minY);
      if (rel > 0.60) score += 6;
      if (rel > 0.78) score += 3;
      if (rel < 0.40) score -= 6;
    }

    const intLen = String(Math.floor(c.value)).replace("-", "").length;

    if (kind === "horimetro") {
      if (intLen >= 4) score += 10;
      else if (intLen === 3) score += 4;
      else score -= 8;

      // referência do último mês (equipament_hours)
      if (refHor != null && Number.isFinite(refHor)) {
        const delta = c.value - refHor;

        if (delta >= -5 && delta <= 2000) {
          const closeness = 20 - clamp(Math.abs(delta) / 10, 0, 20);
          score += 18 + closeness;
        } else {
          score -= 15 + clamp(Math.abs(delta) / 50, 0, 30);
        }
      }

      if (c.hasDecimal) score += 2;
    }

    if (kind === "abastecimento") {
      if (c.hasDecimal) score += 6;
      if (intLen === 2 || intLen === 3) score += 4;
      if (intLen === 1) score -= 2;
      if (intLen >= 4) score -= 4;
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return { best, bestScore, filteredCount: filtered.length };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "horimetro").toLowerCase();
    const url = searchParams.get("url") || "";
    const equip = searchParams.get("equip") || searchParams.get("equipamento") || "";

    if (!url) return jsonError("Informe o parâmetro 'url'.");

    if (!["horimetro", "abastecimento", "odometro"].includes(kind)) {
      return jsonError("Parâmetro 'kind' inválido. Use: horimetro | abastecimento | odometro");
    }

    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Falha ao baixar a imagem (signed URL inválida/expirada?).", 400, { status: imgRes.status });
    }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    if (!buf.length) return jsonError("Imagem vazia.");

    const { raw, anns } = await visionTextDetection(buf);

    // tokens individuais têm bbox (para saber “onde está embaixo”)
    const tokenAnns = (anns || []).slice(1);
    const yRange = computeYRange(tokenAnns);

    const items: Array<{ input: string; value: number; hasDecimal: boolean; centerY: number | null }> = [];

    // 1) tokens individuais
    for (const a of tokenAnns) {
      const t = (a?.description || "").toString().trim();
      if (!t) continue;

      const extracted = extractCandidatesFromText(t);
      const centerY = getBoxCenterY(a);

      for (const ex of extracted.length ? extracted : [t]) {
        const norm = normalizeCandidate(ex);
        if (!norm) continue;
        items.push({ input: norm.input, value: norm.value, hasDecimal: norm.hasDecimal, centerY });
      }
    }

    // 2) complemento: raw inteiro
    for (const ex of extractCandidatesFromText(raw)) {
      const norm = normalizeCandidate(ex);
      if (!norm) continue;
      items.push({ input: norm.input, value: norm.value, hasDecimal: norm.hasDecimal, centerY: null });
    }

    // dedupe
    const seen = new Set<string>();
    const dedup = items.filter((c) => {
      const k = `${c.input}|${c.value}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    let refHor: number | null = null;
    if (kind === "horimetro" && equip) {
      refHor = await getLastHorimetroByEquip(equip);
    }

    const picked = pickBest(kind, dedup, yRange, refHor);

    const candidates = dedup.map((c) => c.value).filter((n) => Number.isFinite(n));
    const candidates_input = dedup.map((c) => c.input);

    if (!picked) {
      return NextResponse.json({
        ok: true,
        kind,
        best: null,
        best_input: null,
        candidates,
        candidates_input,
        raw,
        ref_horimetro: refHor,
      });
    }

    return NextResponse.json({
      ok: true,
      kind,
      best: picked.best.value,
      best_input: picked.best.input,
      candidates,
      candidates_input,
      raw,
      ref_horimetro: refHor,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Falha no OCR.", 500);
  }
}

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeNum(v: any): number | null {
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseSaFromEnv() {
  // aceita os dois nomes (pra não ter mais “vacilo” com env var)
  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 ||
    process.env.GCP_SA_JSON_BASE64 ||
    "";

  if (!b64) throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) não configurada.");

  let raw = "";
  try {
    raw = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    throw new Error("GCP_SA_KEY_BASE64 inválida (não decodifica base64).");
  }

  let sa: any;
  try {
    sa = JSON.parse(raw);
  } catch {
    throw new Error("GCP_SA_KEY_BASE64 inválida (JSON não parseia).");
  }

  if (!sa?.client_email || !sa?.private_key) {
    throw new Error("Service Account inválida (faltando client_email/private_key).");
  }
  return sa as { client_email: string; private_key: string };
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedToken && cachedToken.exp > now + 30) {
    return cachedToken.token;
  }

  const sa = parseSaFromEnv();
  const iat = now;
  const exp = now + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();

  const signature = signer.sign(sa.private_key);
  const jwt = `${unsigned}.${b64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  }).toString();

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Falha ao gerar access_token: ${resp.status} ${t}`.slice(0, 300));
  }

  const data = (await resp.json()) as any;
  const token = String(data.access_token || "");
  if (!token) throw new Error("Falha ao gerar access_token (vazio).");

  cachedToken = { token, exp };
  return token;
}

async function fetchImageAsBase64(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não consegui baixar a imagem (HTTP ${r.status}).`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab).toString("base64");
}

type Vertex = { x?: number; y?: number };
type Token = {
  text: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  area: number;
};

function bboxOf(vertices?: Vertex[]) {
  const vs = (vertices || []).map((v) => ({
    x: typeof v.x === "number" ? v.x : 0,
    y: typeof v.y === "number" ? v.y : 0,
  }));
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  const x1 = xs.length ? Math.min(...xs) : 0;
  const y1 = ys.length ? Math.min(...ys) : 0;
  const x2 = xs.length ? Math.max(...xs) : 0;
  const y2 = ys.length ? Math.max(...ys) : 0;
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const cx = x1 + w / 2;
  const cy = y1 + h / 2;
  return { x1, y1, x2, y2, w, h, cx, cy, area: w * h };
}

function isNumericLike(s: string) {
  // aceita "031,0", "114.6", "03647" etc
  return /^[0-9]+([.,][0-9]+)?$/.test(s.trim());
}

function toBR1DecimalFromDigits(digits: string) {
  // transforma "0310" -> "031,0" / "1146" -> "114,6" / "036470" -> "03647,0"
  const d = digits.replace(/\D/g, "");
  if (d.length < 2) return null;
  const intPart = d.slice(0, -1);
  const dec = d.slice(-1);
  return `${intPart},${dec}`;
}

function parseBRNumber(s: string) {
  const cleaned = s.trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function buildTokens(textAnnotations: any[]): { tokens: Token[]; maxX: number; maxY: number } {
  const words = (textAnnotations || []).slice(1); // [0] é o texto inteiro
  const tokens: Token[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const w of words) {
    const text = String(w?.description || "").trim();
    if (!text) continue;

    const bb = bboxOf(w?.boundingPoly?.vertices);
    maxX = Math.max(maxX, bb.x2);
    maxY = Math.max(maxY, bb.y2);

    tokens.push({ text, ...bb });
  }

  return { tokens, maxX, maxY };
}

function groupByLine(tokens: Token[]) {
  const groups: { cy: number; items: Token[] }[] = [];

  for (const t of tokens) {
    const tol = Math.max(10, t.h * 0.45);
    let g = groups.find((gg) => Math.abs(gg.cy - t.cy) <= tol);

    if (!g) {
      g = { cy: t.cy, items: [] };
      groups.push(g);
    }

    g.items.push(t);
    g.cy = g.items.reduce((acc, it) => acc + it.cy, 0) / g.items.length;
  }

  return groups;
}

function buildCandidatesFromGroups(groups: { cy: number; items: Token[] }[], kind: string) {
  type Cand = {
    input: string;
    value: number;
    score: number;
    area: number;
    hAvg: number;
  };

  const cands: Cand[] = [];

  for (const g of groups) {
    const items = [...g.items].sort((a, b) => a.x1 - b.x1);

    // cria sequências contíguas (tokens “colados” no display)
    const seqs: Token[][] = [];
    let cur: Token[] = [];

    for (const it of items) {
      if (!cur.length) {
        cur = [it];
        continue;
      }
      const prev = cur[cur.length - 1];
      const gap = it.x1 - prev.x2;
      const maxGap = Math.max(18, Math.min(prev.h, it.h) * 1.2);

      if (gap <= maxGap) cur.push(it);
      else {
        seqs.push(cur);
        cur = [it];
      }
    }
    if (cur.length) seqs.push(cur);

    for (const seq of seqs) {
      const parts = seq.map((t) => t.text);
      const joined = parts.join("");

      // só considera sequências numéricas (exclui “RPM”, “QUARTZO”, etc)
      const joinedClean = joined.replace(/\s+/g, "");
      if (!joinedClean) continue;

      // pega só tokens que parecem número
      const onlyNumericTokens = seq.every((t) => isNumericLike(t.text) || /^\d+$/.test(t.text));
      if (!onlyNumericTokens) continue;

      const area = seq.reduce((acc, t) => acc + t.area, 0);
      const hAvg = seq.reduce((acc, t) => acc + t.h, 0) / seq.length;

      // gera variações:
      // 1) se já veio com separador, usa
      const direct = joinedClean;
      const directVal = parseBRNumber(direct.includes(",") || direct.includes(".") ? direct.replace(".", ",") : direct);
      if (directVal != null) {
        cands.push({
          input: direct.includes(".") ? direct.replace(".", ",") : direct,
          value: directVal,
          score: 0,
          area,
          hAvg,
        });
      }

      // 2) se veio “em pedaços” (ex: "031" + "0"), força 1 decimal
      if (seq.length >= 2) {
        const last = seq[seq.length - 1].text;
        const prev = seq[seq.length - 2].text;
        if (/^\d$/.test(last) && /^\d{2,6}$/.test(prev)) {
          const input = `${prev},${last}`;
          const val = parseBRNumber(input);
          if (val != null) {
            cands.push({ input, value: val, score: 0, area: area * 1.15, hAvg });
          }
        }
      }

      // 3) se veio tudo colado (ex: "0310", "1146", "036470"), converte p/ 1 decimal
      if (/^\d{3,6}$/.test(joinedClean)) {
        const input = toBR1DecimalFromDigits(joinedClean);
        if (input) {
          const val = parseBRNumber(input);
          if (val != null) {
            cands.push({ input, value: val, score: 0, area: area * 1.05, hAvg });
          }
        }
      }
    }
  }

  // scoring por tipo
  for (const c of cands) {
    let s = c.hAvg * 1000 + c.area * 0.002;

    const intPart = c.input.split(",")[0].replace(/\D/g, "");
    const hasDecimal1 = /,\d$/.test(c.input);

    if (kind === "horimetro") {
      // horímetro normalmente é >= 100 e “comprido”
      if (c.value < 50) s -= 50000;
      if (c.value >= 100) s += 5000;

      // evita cair em “100” e números curtos
      if (intPart.length >= 4) s += 8000;
      else s -= 5000;

      if (hasDecimal1) s += 2000;
    } else if (kind === "abastecimento") {
      // litros normalmente 0..400 (ajuste se precisar)
      if (c.value < 0 || c.value > 600) s -= 50000;

      // display grande geralmente tem 2-3 dígitos antes da vírgula (031,0 / 114,6)
      if (intPart.length === 3) s += 8000;
      if (intPart.length === 2) s += 4000;
      if (intPart.length >= 4) s -= 8000;

      if (hasDecimal1) s += 3000;
    }

    c.score = s;
  }

  // ordena
  cands.sort((a, b) => b.score - a.score);

  // remove duplicados (mesmo valor)
  const unique: Cand[] = [];
  for (const c of cands) {
    if (!unique.some((u) => Math.abs(u.value - c.value) < 0.0001)) unique.push(c);
  }

  return unique.slice(0, 10);
}

async function tryGetRefHorimetro(equip?: string | null) {
  if (!equip) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // tenta filtrar por 'equipamento'; se der erro de coluna, cai no fallback
  let rows: any[] | null = null;

  const attempt1 = await supabase
    .from("equipament_hours")
    .select("*")
    .eq("equipamento", equip)
    .limit(80);

  if (!attempt1.error) rows = attempt1.data as any[];

  if (!rows) {
    // fallback: pega um bloco e filtra no JS por possíveis colunas
    const attempt2 = await supabase.from("equipament_hours").select("*").limit(200);
    if (attempt2.error) return null;

    const all = (attempt2.data as any[]) || [];
    const equipKeys = ["equipamento", "equip", "equipment", "codigo", "code"];
    rows = all.filter((r) => {
      const v = equipKeys.map((k) => r?.[k]).find((x) => typeof x === "string");
      return String(v || "").trim().toUpperCase() === String(equip).trim().toUpperCase();
    });
  }

  if (!rows || !rows.length) return null;

  // escolhe a “mais recente” por data/created_at/ano+mes
  const pickTime = (r: any) => {
    const d = r?.data || r?.date;
    const ca = r?.created_at;
    const ano = safeNum(r?.ano) ?? safeNum(r?.year);
    const mes = safeNum(r?.mes) ?? safeNum(r?.month);

    if (d) {
      const t = new Date(String(d)).getTime();
      if (Number.isFinite(t)) return t;
    }
    if (ca) {
      const t = new Date(String(ca)).getTime();
      if (Number.isFinite(t)) return t;
    }
    if (ano != null && mes != null) return ano * 100 + mes;
    return 0;
  };

  rows.sort((a, b) => pickTime(b) - pickTime(a));

  const hrKeys = [
    "horimetro",
    "horimetro_final",
    "horimetro_fim",
    "horimetro_mes",
    "horimetro_atual",
    "hours",
  ];

  for (const r of rows) {
    for (const k of hrKeys) {
      const v = safeNum(r?.[k]);
      if (v != null) return v;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase().trim();
    const url = searchParams.get("url") || "";
    const equip = searchParams.get("equip");

    if (!url) return json(400, { ok: false, error: "Parâmetro url é obrigatório." });
    if (kind !== "horimetro" && kind !== "abastecimento") {
      return json(400, { ok: false, error: "kind inválido. Use horimetro | abastecimento." });
    }

    const accessToken = await getAccessToken();
    const imgB64 = await fetchImageAsBase64(url);

    const visionResp = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: imgB64 },
            features: [{ type: "TEXT_DETECTION" }],
            imageContext: { languageHints: ["pt", "en"] },
          },
        ],
      }),
    });

    if (!visionResp.ok) {
      const t = await visionResp.text().catch(() => "");
      return json(500, {
        ok: false,
        error: `Vision API falhou: ${visionResp.status}`,
        detail: t.slice(0, 500),
      });
    }

    const payload = (await visionResp.json()) as any;
    const ann = payload?.responses?.[0]?.textAnnotations || [];
    const raw = String(ann?.[0]?.description || "").trim();

    const { tokens, maxX, maxY } = buildTokens(ann);

    // filtra tokens numéricos
    const numericTokens = tokens.filter((t) => isNumericLike(t.text));

    // ROI por tipo (pra evitar “RPM x 100” e escala do relógio)
    const roi =
      kind === "horimetro"
        ? numericTokens.filter((t) => t.cy >= maxY * 0.40) // parte de baixo (onde fica o display do horímetro)
        : numericTokens.filter((t) => t.cy <= maxY * 0.80); // evita pegar totalizador muito baixo (ajuste se necessário)

    const groups = groupByLine(roi);
    const candidates = buildCandidatesFromGroups(groups, kind);

    // ref do horímetro (opcional) pra evitar pegar número errado quando o OCR “viaja”
    const ref_horimetro = kind === "horimetro" ? await tryGetRefHorimetro(equip) : null;

    let best = candidates[0] || null;

    if (kind === "horimetro" && ref_horimetro != null && candidates.length) {
      // escolhe o candidato mais “plausível” perto do último conhecido
      const scored = candidates
        .map((c) => {
          const diff = Math.abs(c.value - ref_horimetro);
          // penaliza saltos absurdos
          const penalty = diff > 500 ? 20000 : diff * 20;
          return { c, finalScore: c.score - penalty };
        })
        .sort((a, b) => b.finalScore - a.finalScore);

      best = scored[0]?.c || best;
    }

    return json(200, {
      ok: true,
      kind,
      best: best ? best.value : null,
      best_input: best ? best.input : null,
      candidates: candidates.map((c) => c.value),
      candidates_input: candidates.map((c) => c.input),
      raw,
      ref_horimetro: ref_horimetro ?? null,
      debug: { token_count: tokens.length, numeric_count: numericTokens.length, roi_count: roi.length, maxX, maxY },
    });
  } catch (e: any) {
    return json(500, { ok: false, error: e?.message || "Erro inesperado." });
  }
}

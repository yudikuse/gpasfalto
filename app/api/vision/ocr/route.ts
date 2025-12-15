import { NextResponse } from "next/server";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra || {}) }, { status });
}

let _visionClient: ImageAnnotatorClient | null = null;

function getVisionClient() {
  if (_visionClient) return _visionClient;

  // ✅ aceita os 2 nomes (o seu está como GCP_SA_KEY_BASE64)
  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 ||
    "";

  if (!b64) {
    throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) não configurada.");
  }

  let creds: any;
  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    creds = JSON.parse(json);
  } catch {
    throw new Error("Env GCP_SA_KEY_BASE64 inválida (esperado JSON em base64).");
  }

  _visionClient = new ImageAnnotatorClient({
    projectId: creds.project_id,
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
  });

  return _visionClient;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

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

  // mantém só dígitos + separadores
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const sep = Math.max(lastComma, lastDot);

  let hasDecimal = false;
  let asNumberStr = "";

  if (sep !== -1) {
    const decLen = s.length - sep - 1;
    // decimal típico (1 ou 2 casas)
    if (decLen >= 1 && decLen <= 2) {
      hasDecimal = true;
      const intPart = s.slice(0, sep).replace(/[.,]/g, "");
      const decPart = s.slice(sep + 1).replace(/[.,]/g, "");
      asNumberStr = `${intPart}.${decPart}`;
      const br = `${intPart},${decPart}`;
      const n = Number.parseFloat(asNumberStr);
      if (!Number.isFinite(n)) return null;
      return { input: br, value: n, hasDecimal };
    }
  }

  // sem decimal (ou separadores ruins): trata como inteiro
  const intPart = s.replace(/[.,]/g, "");
  asNumberStr = intPart;
  const n = Number.parseFloat(asNumberStr);
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

  // tenta os dois nomes (você mencionou "equipament_hours")
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

function pickBest(kind: string, items: Array<{
  input: string;
  value: number;
  hasDecimal: boolean;
  centerY: number | null;
}>, yRange: {minY:number;maxY:number} | null, refHor: number | null) {
  if (!items.length) return null;

  // filtro “anti-escala”: se existe candidato grande, ignora pequenos (ex.: 100 do RPM x 100)
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

    // posição (prioriza parte inferior da imagem)
    if (yRange && c.centerY != null) {
      const rel = (c.centerY - yRange.minY) / (yRange.maxY - yRange.minY);
      // 0..1
      if (rel > 0.60) score += 6;
      if (rel > 0.78) score += 3;
      if (rel < 0.40) score -= 6;
    }

    const intLen = String(Math.floor(c.value)).replace("-", "").length;

    if (kind === "horimetro") {
      // horímetro geralmente tem 4+ dígitos (ou 3 em alguns casos), evita 1-2 dígitos
      if (intLen >= 4) score += 10;
      else if (intLen === 3) score += 4;
      else score -= 8;

      // se temos referência do último mês, escolhe o mais próximo do valor esperado
      if (refHor != null && Number.isFinite(refHor)) {
        const delta = c.value - refHor;

        // preferir >= refHor (ou bem perto, se foto ruim)
        if (delta >= -5 && delta <= 2000) {
          // quanto mais perto (principalmente acima), melhor
          const closeness = 20 - clamp(Math.abs(delta) / 10, 0, 20);
          score += 18 + closeness;
        } else {
          // muito fora: penaliza
          score -= 15 + clamp(Math.abs(delta) / 50, 0, 30);
        }
      }

      // decimal 1 casa é comum (não obrigatório)
      if (c.hasDecimal) score += 2;
    }

    if (kind === "abastecimento") {
      // litros: preferir decimal 1 casa
      if (c.hasDecimal) score += 6;
      // preferir 2–3 dígitos inteiros (10–999)
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
    const equip =
      searchParams.get("equip") ||
      searchParams.get("equipamento") ||
      "";

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

    const client = getVisionClient();
    const [result] = await client.textDetection({ image: { content: buf } });

    const anns: any[] = (result as any)?.textAnnotations || [];
    const raw = (anns?.[0]?.description || "").toString().trim();

    // tokens com bbox (para saber “parte de baixo”)
    const tokenAnns = anns.slice(1);
    const yRange = computeYRange(tokenAnns);

    const items: Array<{ input: string; value: number; hasDecimal: boolean; centerY: number | null }> = [];

    // 1) pega dos tokens individuais (melhor pra bbox)
    for (const a of tokenAnns) {
      const t = (a?.description || "").toString().trim();
      if (!t) continue;

      // tenta extrair número(s) do token
      const extracted = extractCandidatesFromText(t);
      const centerY = getBoxCenterY(a);

      for (const ex of extracted.length ? extracted : [t]) {
        const norm = normalizeCandidate(ex);
        if (!norm) continue;

        items.push({
          input: norm.input,
          value: norm.value,
          hasDecimal: norm.hasDecimal,
          centerY,
        });
      }
    }

    // 2) complemento: pega do texto “raw” completo
    for (const ex of extractCandidatesFromText(raw)) {
      const norm = normalizeCandidate(ex);
      if (!norm) continue;

      items.push({
        input: norm.input,
        value: norm.value,
        hasDecimal: norm.hasDecimal,
        centerY: null,
      });
    }

    // dedupe por input
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

    const candidates = dedup
      .map((c) => c.value)
      .filter((n) => Number.isFinite(n));

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

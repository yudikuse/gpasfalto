import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ImageAnnotatorClient } from "@google-cloud/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "horimetro" | "abastecimento" | "odometro";

type BBox = { minX: number; minY: number; maxX: number; maxY: number };
type Token = {
  text: string;
  digits: string;
  bbox: BBox;
  area: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

type Run = {
  parts: Token[];
  bbox: BBox;
  digits: string;
  area: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function bboxFromVertices(vertices?: Array<{ x?: number | null; y?: number | null }>): BBox | null {
  if (!vertices || vertices.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const v of vertices) {
    const x = typeof v?.x === "number" ? v.x : 0;
    const y = typeof v?.y === "number" ? v.y : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY };
}

function unionBBox(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function bboxMetrics(b: BBox) {
  const w = Math.max(0, b.maxX - b.minX);
  const h = Math.max(0, b.maxY - b.minY);
  const area = w * h;
  const cx = b.minX + w / 2;
  const cy = b.minY + h / 2;
  return { w, h, area, cx, cy };
}

function toPtBr1(value: number) {
  // 1 casa decimal sempre, com vírgula
  if (!isFinite(value)) return "";
  return value.toFixed(1).replace(".", ",");
}

function parseKind(k: string | null): Kind {
  const v = (k || "").toLowerCase().trim();
  if (v === "horimetro" || v === "abastecimento" || v === "odometro") return v;
  return "horimetro";
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

function getVisionClient() {
  const b64 = process.env.GCP_SA_KEY_BASE64 || process.env.GCP_KEY_BASE64 || "";
  if (!b64) {
    throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) não configurada.");
  }
  const jsonStr = Buffer.from(b64, "base64").toString("utf-8");
  const creds = JSON.parse(jsonStr);

  const projectId = process.env.GCP_PROJECT_ID || creds.project_id || "";
  if (!projectId) {
    throw new Error("Env GCP_PROJECT_ID não configurada (e project_id não encontrado na key).");
  }

  return new ImageAnnotatorClient({
    projectId,
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
  });
}

function extractTokens(textAnnotations: any[]): { tokens: Token[]; imgW: number; imgH: number } {
  const tokens: Token[] = [];

  // Ignora o [0] que é o texto completo
  for (let i = 1; i < (textAnnotations?.length || 0); i++) {
    const a = textAnnotations[i];
    const text = String(a?.description || "").trim();
    if (!text) continue;

    const digits = text.replace(/[^\d]/g, "");
    if (!digits) continue;

    const bb = bboxFromVertices(a?.boundingPoly?.vertices);
    if (!bb) continue;

    const m = bboxMetrics(bb);
    tokens.push({
      text,
      digits,
      bbox: bb,
      area: m.area,
      cx: m.cx,
      cy: m.cy,
      w: m.w,
      h: m.h,
    });
  }

  // tenta inferir dimensão da imagem via maior bounding box
  let imgW = 0;
  let imgH = 0;
  for (const t of tokens) {
    imgW = Math.max(imgW, t.bbox.maxX);
    imgH = Math.max(imgH, t.bbox.maxY);
  }
  imgW = imgW || 1;
  imgH = imgH || 1;

  return { tokens, imgW, imgH };
}

function buildRuns(tokens: Token[], imgW: number, imgH: number): Run[] {
  if (!tokens.length) return [];

  // agrupa por "linha" (y parecido)
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy);
  const lineTol = Math.max(12, imgH * 0.035);

  const lines: Token[][] = [];
  let cur: Token[] = [];
  let curY = sorted[0].cy;

  for (const t of sorted) {
    if (!cur.length) {
      cur = [t];
      curY = t.cy;
      continue;
    }
    if (Math.abs(t.cy - curY) <= lineTol) {
      cur.push(t);
      // atualiza centro da linha suavemente
      curY = (curY * (cur.length - 1) + t.cy) / cur.length;
    } else {
      lines.push(cur);
      cur = [t];
      curY = t.cy;
    }
  }
  if (cur.length) lines.push(cur);

  // dentro de cada linha, monta "runs" por proximidade em X
  const runs: Run[] = [];
  const gapTol = Math.max(18, imgW * 0.03);

  for (const line of lines) {
    const byX = [...line].sort((a, b) => a.cx - b.cx);

    let parts: Token[] = [];
    let bbox: BBox | null = null;

    const flush = () => {
      if (!parts.length || !bbox) return;
      const digits = parts.map((p) => p.digits).join("");
      const m = bboxMetrics(bbox);
      runs.push({ parts, bbox, digits, area: m.area, cx: m.cx, cy: m.cy, w: m.w, h: m.h });
    };

    for (const t of byX) {
      if (!parts.length) {
        parts = [t];
        bbox = t.bbox;
        continue;
      }
      const prev = parts[parts.length - 1];
      const gap = t.bbox.minX - prev.bbox.maxX;

      // se muito longe, fecha run e abre outro
      if (gap > gapTol) {
        flush();
        parts = [t];
        bbox = t.bbox;
      } else {
        parts.push(t);
        bbox = unionBBox(bbox!, t.bbox);
      }
    }
    flush();
  }

  return runs;
}

function pickDecimalFromParts(run: Run): { mainDigits: string; decDigit: string | null } {
  // heurística: main = partes "grandes" (altura próxima da maior)
  const maxH = run.parts.reduce((acc, p) => Math.max(acc, p.h), 0) || 1;
  const big = run.parts
    .slice()
    .sort((a, b) => a.cx - b.cx)
    .filter((p) => p.digits.length >= 1 && p.h >= maxH * 0.75);

  const mainDigits = big.map((p) => p.digits).join("");

  // decimal: 1 dígito pequeno imediatamente à direita do bloco grande
  const mainLast = big[big.length - 1];
  const candidates = run.parts
    .slice()
    .sort((a, b) => a.cx - b.cx)
    .filter((p) => p.digits.length === 1);

  let dec: Token | null = null;
  for (const c of candidates) {
    if (!mainLast) continue;
    const right = c.bbox.minX >= mainLast.bbox.maxX - 1;
    const close = c.bbox.minX - mainLast.bbox.maxX <= Math.max(10, run.w * 0.08);
    const similarY = Math.abs(c.cy - mainLast.cy) <= Math.max(10, run.h * 0.25);
    const smaller = c.h <= mainLast.h * 0.95;

    if (right && close && similarY && smaller) {
      dec = c;
      break;
    }
  }

  return { mainDigits, decDigit: dec ? dec.digits : null };
}

function valueFromDigitsForLiters(digits: string): number | null {
  const d = digits.replace(/[^\d]/g, "");
  if (!d) return null;
  if (d.length === 1) return null;

  // regra: último dígito é decimal
  const intPart = d.slice(0, -1);
  const dec = d.slice(-1);
  const intNum = parseInt(intPart || "0", 10);
  const v = Number(`${intNum}.${dec}`);
  return isFinite(v) ? v : null;
}

function genDigitsVariantsForLiters(raw: string): Array<{ digits: string; edits: number; note: string }> {
  const base = raw.replace(/[^\d]/g, "");
  const out: Array<{ digits: string; edits: number; note: string }> = [];
  if (!base) return out;

  const push = (digits: string, edits: number, note: string) => {
    if (!digits) return;
    if (!out.some((x) => x.digits === digits)) out.push({ digits, edits, note });
  };

  push(base, 0, "raw");

  // se veio com 3 dígitos, é MUITO comum o OCR "comer" o último 0 decimal → tenta append 0
  if (base.length === 3) push(base + "0", 1, "append0");

  // correção comum: 3 ↔ 9 (glare). tenta trocar qualquer '9' por '3'
  for (let i = 0; i < base.length; i++) {
    if (base[i] === "9") {
      const replaced = base.slice(0, i) + "3" + base.slice(i + 1);
      push(replaced, 1, "9to3");
      if (base.length === 3) push(replaced + "0", 2, "9to3+append0");
    }
  }

  return out;
}

function scoreHorimetro(run: Run, imgW: number, imgH: number, ref?: number | null) {
  const { mainDigits, decDigit } = pickDecimalFromParts(run);

  // horímetro: NÃO inventa decimal se não achou
  if (!mainDigits) return { ok: false as const };

  const intNum = parseInt(mainDigits, 10);
  if (!isFinite(intNum)) return { ok: false as const };

  const value = decDigit ? Number(`${intNum}.${decDigit}`) : Number(intNum);
  if (!isFinite(value)) return { ok: false as const };

  // heurísticas
  let s = 0;
  const len = mainDigits.length;

  s += Math.log(run.area + 1) * 10;
  s += len * 25;

  // evita pegar 60/70/110/100 do painel: valores muito baixos penalizam
  if (value < 200) s -= 200;

  // horímetro geralmente fica mais na metade de baixo da foto
  if (run.cy > imgH * 0.45) s += 40;
  else s -= 15;

  // se tiver referência (fim de mês), tenta ficar próximo
  if (typeof ref === "number" && isFinite(ref)) {
    const diff = Math.abs(value - ref);
    s += clamp(80 - diff * 2, -40, 80);
    if (value < ref - 5) s -= 60;
  }

  return {
    ok: true as const,
    score: s,
    value,
    best_input: toPtBr1(value),
    picked: { mainDigits, decDigit: decDigit || null },
  };
}

function scoreAbastecimento(run: Run, imgW: number, imgH: number) {
  // abastecimento: regra último dígito decimal e normalmente está mais na metade de cima
  // pega "digits brutos" da run (já concatenado)
  const rawDigits = run.digits.replace(/[^\d]/g, "");
  if (!rawDigits || rawDigits.length < 2) return { ok: false as const };

  const variants = genDigitsVariantsForLiters(rawDigits);

  // avalia variantes: prefere faixa plausível e poucas edições
  let best: { score: number; value: number; best_input: string; picked: any } | null = null;

  for (const v of variants) {
    const value = valueFromDigitsForLiters(v.digits);
    if (value == null) continue;

    let s = 0;

    // preferir run grande (dígitos grandes do medidor)
    s += Math.log(run.area + 1) * 12;

    // abastecimento fica no topo (serial fica embaixo)
    if (run.cy < imgH * 0.65) s += 50;
    else s -= 80;

    // faixa plausível (ajuste fino depois, mas já mata 9,1 em muitos casos)
    if (value >= 10 && value <= 600) s += 120;
    else if (value >= 5 && value <= 800) s += 50;
    else s -= 120;

    // penaliza “correções”
    s -= v.edits * 35;

    // preferir 3–4 dígitos antes do decimal (ex.: 0310 / 1146)
    if (v.digits.length === 4) s += 25;
    if (v.digits.length === 3) s -= 10;

    const best_input = toPtBr1(value);
    if (!best || s > best.score) {
      best = { score: s, value, best_input, picked: { digits: v.digits, note: v.note, edits: v.edits } };
    }
  }

  if (!best) return { ok: false as const };

  return { ok: true as const, ...best };
}

async function tryFetchRefHorimetro(equip: string): Promise<number | null> {
  // best-effort: se a tabela/view existir com colunas esperadas, usamos.
  // Se não existir, não quebra nada.
  try {
    const sb = getSupabase();
    if (!sb) return null;

    const code = equip.trim().toUpperCase();

    // tenta alguns nomes comuns (sem saber teu schema exato)
    const tablesToTry = ["equipament_hours", "equipment_hours", "equipament_hours_2025"];
    for (const table of tablesToTry) {
      const { data, error } = await sb
        .from(table)
        .select("horimetro, data, mes, ano, created_at")
        .eq("equipamento", code)
        .order("data", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1);

      if (error) continue;
      const h = data?.[0]?.horimetro;
      const num = typeof h === "number" ? h : typeof h === "string" ? Number(h.replace(",", ".")) : NaN;
      if (isFinite(num)) return num;
    }

    return null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const kind = parseKind(searchParams.get("kind"));
  const url = searchParams.get("url");
  const equip = searchParams.get("equip") || undefined;

  if (!url) return jsonError("Parâmetro url é obrigatório.", 400);

  let client: ImageAnnotatorClient;
  try {
    client = getVisionClient();
  } catch (e: any) {
    return jsonError("OCR: configuração do Google inválida.", 500, { message: String(e?.message || e) });
  }

  // referência opcional (ajuda horímetro a não pegar 100/70/60)
  const ref_horimetro = kind === "horimetro" && equip ? await tryFetchRefHorimetro(equip) : null;

  try {
    const [result] = await client.documentTextDetection({
      image: { source: { imageUri: url } },
    });

    const textAnnotations = (result as any)?.textAnnotations || [];
    const fullRaw = String(textAnnotations?.[0]?.description || "");

    const { tokens, imgW, imgH } = extractTokens(textAnnotations);
    const runs = buildRuns(tokens, imgW, imgH);

    // calcula scores por kind
    const scored = runs
      .map((r) => {
        if (kind === "horimetro") {
          const s = scoreHorimetro(r, imgW, imgH, ref_horimetro);
          return s.ok ? { run: r, score: s.score, value: s.value, best_input: s.best_input, picked: s.picked } : null;
        }
        if (kind === "abastecimento") {
          const s = scoreAbastecimento(r, imgW, imgH);
          return s.ok ? { run: r, score: s.score, value: s.value, best_input: s.best_input, picked: s.picked } : null;
        }
        // odometro (fallback): usa regra de litros (último dígito decimal) mas sem faixa tão restrita
        const s = scoreAbastecimento(r, imgW, imgH);
        return s.ok ? { run: r, score: s.score - 40, value: s.value, best_input: s.best_input, picked: s.picked } : null;
      })
      .filter(Boolean) as Array<{ run: Run; score: number; value: number; best_input: string; picked: any }>;

    scored.sort((a, b) => b.score - a.score);

    const top = scored.slice(0, 8).map((x) => ({
      value: x.value,
      best_input: x.best_input,
      score: Math.round(x.score),
      digits: x.run.digits,
      bbox: x.run.bbox,
      picked: x.picked,
    }));

    const best = scored[0];
    if (!best) {
      return NextResponse.json({
        ok: false,
        kind,
        error: "Não consegui identificar um número confiável na imagem.",
        raw: fullRaw,
        ref_horimetro,
        debug: { imgW, imgH, token_count: tokens.length, run_count: runs.length },
      });
    }

    return NextResponse.json({
      ok: true,
      kind,
      best: String(best.value),          // ex: "31" ou "31.0" / "3647.2"
      best_input: best.best_input,       // pt-BR com vírgula e 1 casa
      candidates: top.map((c) => c.value),
      raw: fullRaw,
      ref_horimetro,
      debug: {
        imgW,
        imgH,
        token_count: tokens.length,
        run_count: runs.length,
        top,
        picked: best.picked,
      },
    });
  } catch (e: any) {
    return jsonError("Erro ao executar OCR.", 500, { message: String(e?.message || e) });
  }
}

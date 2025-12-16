import { NextRequest, NextResponse } from "next/server";
import { ImageAnnotatorClient } from "@google-cloud/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "horimetro" | "abastecimento";

function jsonError(message: string, status = 400, extra: any = {}) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function decodeServiceAccountFromEnv() {
  // Aceita:
  // - GCP_KEY_BASE64: JSON do service account em base64
  // - GCP_KEY_JSON: JSON puro
  const b64 = process.env.GCP_KEY_BASE64 || "";
  const raw = process.env.GCP_KEY_JSON || "";

  try {
    if (b64) {
      const json = Buffer.from(b64, "base64").toString("utf8");
      return JSON.parse(json);
    }
    if (raw) return JSON.parse(raw);
  } catch (e) {
    return null;
  }
  return null;
}

function bboxToBox(bb: any) {
  const verts = bb?.vertices || [];
  const xs = verts.map((p: any) => (typeof p?.x === "number" ? p.x : 0));
  const ys = verts.map((p: any) => (typeof p?.y === "number" ? p.y : 0));
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY };
}

type DigitSym = {
  ch: string;
  x: number;
  y: number;
  h: number;
  w: number;
  box: { minX: number; maxX: number; minY: number; maxY: number };
};

function median(nums: number[]) {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function collectDigitSymbols(full: any): DigitSym[] {
  const out: DigitSym[] = [];
  const pages = full?.pages || [];
  for (const page of pages) {
    for (const block of page?.blocks || []) {
      for (const para of block?.paragraphs || []) {
        for (const word of para?.words || []) {
          for (const sym of word?.symbols || []) {
            const ch = String(sym?.text || "");
            if (!/^\d$/.test(ch)) continue;
            const box = bboxToBox(sym?.boundingBox);
            if (!box) continue;
            const h = box.maxY - box.minY;
            const w = box.maxX - box.minX;
            if (h <= 0 || w <= 0) continue;
            const x = (box.minX + box.maxX) / 2;
            const y = (box.minY + box.maxY) / 2;
            out.push({ ch, x, y, h, w, box });
          }
        }
      }
    }
  }
  return out;
}

function formatPt(value: number, decimals: number) {
  // sem separador de milhar, com vírgula
  return value.toFixed(decimals).replace(".", ",");
}

function pickAbastecimento(symbols: DigitSym[], imgH: number) {
  if (!symbols.length) return null;

  const maxH = Math.max(...symbols.map((s) => s.h));
  // pega só os dígitos “grandes” (os de cima)
  let big = symbols.filter((s) => s.h >= maxH * 0.7 && s.y < imgH * 0.85);
  if (big.length < 4) big = symbols.filter((s) => s.h >= maxH * 0.6 && s.y < imgH * 0.85);

  const yMed = median(big.map((s) => s.y));
  const row = big.filter((s) => Math.abs(s.y - yMed) <= maxH * 0.6);

  const sorted = [...row].sort((a, b) => a.x - b.x);

  // dedupe de símbolos muito próximos (OCR às vezes duplica)
  const dedup: DigitSym[] = [];
  for (const s of sorted) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(s.x - last.x) <= Math.min(last.w, s.w) * 0.35) {
      if (s.h > last.h) dedup[dedup.length - 1] = s;
    } else {
      dedup.push(s);
    }
  }

  const digitsAll = dedup.map((s) => s.ch).join("");
  const digits = digitsAll.slice(0, 4); // regra do seu medidor: 4 dígitos grandes

  if (digits.length !== 4) return null;

  const intStr = digits.slice(0, 3);
  const decStr = digits[3];

  const intVal = parseInt(intStr, 10);
  const best = Number(`${intVal}.${decStr}`);
  const best_input = formatPt(best, 1);

  return {
    best,
    best_input,
    digits,
    debug: { maxH, yMed, pickedDigits: digitsAll }
  };
}

function clusterRows(symbols: DigitSym[]) {
  const syms = [...symbols].sort((a, b) => a.y - b.y);
  const rows: DigitSym[][] = [];
  for (const s of syms) {
    let placed = false;
    for (const row of rows) {
      const yMed = median(row.map((r) => r.y));
      const hMed = median(row.map((r) => r.h));
      if (Math.abs(s.y - yMed) <= hMed * 0.9) {
        row.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([s]);
  }
  return rows;
}

function sequencesInRow(row: DigitSym[]) {
  const sorted = [...row].sort((a, b) => a.x - b.x);
  const seqs: DigitSym[][] = [];
  let cur: DigitSym[] = [];
  for (const s of sorted) {
    if (!cur.length) {
      cur = [s];
      continue;
    }
    const prev = cur[cur.length - 1];
    const h = Math.min(prev.h, s.h);
    const gap = s.box.minX - prev.box.maxX;
    if (gap <= h * 2.2) cur.push(s);
    else {
      seqs.push(cur);
      cur = [s];
    }
  }
  if (cur.length) seqs.push(cur);
  return seqs;
}

function pickHorimetro(symbols: DigitSym[], imgH: number) {
  if (!symbols.length) return null;

  const rows = clusterRows(symbols);
  const candidates: { seq: DigitSym[]; score: number; digits: string; y: number; h: number }[] = [];

  for (const row of rows) {
    for (const seq0 of sequencesInRow(row)) {
      if (seq0.length < 4) continue;
      const seq = [...seq0].sort((a, b) => a.x - b.x);
      const digits = seq.map((s) => s.ch).join("");
      const y = median(seq.map((s) => s.y));
      const h = median(seq.map((s) => s.h));

      // score: prefere sequências longas e mais “embaixo” (janela do horímetro)
      const score = seq.length * 100 + (y / imgH) * 50;
      candidates.push({ seq, score, digits, y, h });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const bestSeq = candidates[0];
  if (!bestSeq) return null;

  // tenta achar 1 dígito decimal logo abaixo da sequência principal (se existir)
  const minX = Math.min(...bestSeq.seq.map((s) => s.box.minX));
  const maxX = Math.max(...bestSeq.seq.map((s) => s.box.maxX));
  const centerX = (minX + maxX) / 2;

  const decCandidates = symbols
    .filter((s) => s.x >= minX - bestSeq.h && s.x <= maxX + bestSeq.h)
    .filter((s) => s.y > bestSeq.y + bestSeq.h * 0.7)
    .filter((s) => s.h <= bestSeq.h * 0.95);

  const dec = decCandidates.length
    ? decCandidates.sort((a, b) => Math.abs(a.x - centerX) - Math.abs(b.x - centerX))[0].ch
    : "0";

  const intVal = parseInt(bestSeq.digits.replace(/^0+/, "") || "0", 10);
  const best = Number(`${intVal}.${dec}`);
  // horímetro com 2 casas (máscara 1234,50)
  const best_input = formatPt(best, 2);

  return {
    best,
    best_input,
    digits: bestSeq.digits,
    dec,
    debug: {
      seqLen: bestSeq.seq.length,
      pickedRowY: bestSeq.y
    }
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kindRaw = (searchParams.get("kind") || "").toLowerCase();
    const kind = (kindRaw === "horimetro" || kindRaw === "abastecimento" ? kindRaw : "") as Kind;

    const url = searchParams.get("url") || "";
    const equip = searchParams.get("equip") || null;

    if (!kind) return jsonError("Parâmetro 'kind' inválido.", 400);
    if (!url) return jsonError("Parâmetro 'url' obrigatório.", 400);

    const sa = decodeServiceAccountFromEnv();
    if (!sa) return jsonError("Credenciais GCP ausentes (GCP_KEY_BASE64 ou GCP_KEY_JSON).", 500);

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return jsonError(`Falha ao baixar imagem (${r.status}).`, 400);

    const buf = Buffer.from(await r.arrayBuffer());

    const client = new ImageAnnotatorClient({
      credentials: {
        client_email: sa.client_email,
        private_key: sa.private_key
      },
      projectId: sa.project_id
    });

    const [res] = await client.textDetection({ image: { content: buf } });

    const fullText = res?.fullTextAnnotation?.text || res?.textAnnotations?.[0]?.description || "";
    const symbols = collectDigitSymbols(res?.fullTextAnnotation);

    // tenta pegar dimensão (às vezes vem vazio; usamos fallback)
    const imgH =
      res?.fullTextAnnotation?.pages?.[0]?.height ||
      res?.fullTextAnnotation?.pages?.[0]?.property?.detectedLanguages?.[0]?.confidence || // fallback inútil mas evita crash
      0;

    // fallback real se não vier height:
    const safeImgH = typeof imgH === "number" && imgH > 0 ? imgH : 2000;

    let picked:
      | { best: number; best_input: string; digits: string; debug?: any }
      | null = null;

    if (kind === "abastecimento") picked = pickAbastecimento(symbols, safeImgH);
    if (kind === "horimetro") picked = pickHorimetro(symbols, safeImgH);

    if (!picked) {
      return NextResponse.json({
        ok: true,
        kind,
        equip,
        best: null,
        best_input: "",
        candidates: [],
        candidates_input: [],
        raw: fullText,
        ref_horimetro: null,
        debug: { symbols: symbols.length }
      });
    }

    return NextResponse.json({
      ok: true,
      kind,
      equip,
      best: picked.best,
      best_input: picked.best_input,
      candidates: [picked.best],
      candidates_input: [picked.best_input],
      raw: fullText,
      ref_horimetro: null,
      debug: picked.debug || {}
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR.", 500);
  }
}

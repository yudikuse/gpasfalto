// FILE: app/material/novo/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type TicketTipo = "ENTRADA" | "SAIDA";

type OcResumo = {
  plan_id: number | null;
  obra: string;
  oc: string | null;
  material: string;
  ilimitado: boolean | null;
  total_t: number | null;
  entrada_t: number | null;
  saida_t: number | null;
  saldo_t: number | null;
};

type Acumulados = {
  dia_qtd: number | null;
  dia_total_t: number | null;
  semana_ini: string | null;
  semana_fim: string | null;
  semana_qtd: number | null;
  semana_total_t: number | null;
  mes_ini: string | null;
  mes_fim: string | null;
  mes_qtd: number | null;
  mes_total_t: number | null;
};

type EntradaPlanResumo = {
  plan_id: number;
  origem: string;
  obra: string;
  produto: string;
  pedido: number | null;
  volume_entr: number | null;
  saldo_rest: number | null;
};

type EntradaPlan = {
  id: number;
  origem: string;
  obra: string;
  material: string;
  pedido_t: number | null;
  inicio_em: string | null;
  offset_t: number | null;
};

type EntradaAlloc = {
  plan_id: number | null;
  obra: string;
  peso: number;
  over?: boolean;
};

const PATIO_FETZ_OBRA = "PÁTIO USINA (FETZ+FRETE)";

function extFromFile(file: File) {
  const t = (file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("pdf")) return "pdf";
  return "jpg";
}

function maskDateBRInput(raw: string) {
  const d = (raw || "").replace(/\D+/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  if (d.length <= 6) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`;
}

function maskTimeInput(raw: string) {
  const d = (raw || "").replace(/\D+/g, "").slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}:${d.slice(2)}`;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`;
}

function maskPesoTon3(raw: string) {
  const digits = (raw || "").replace(/\D+/g, "").slice(0, 15);
  if (!digits) return "";
  const n = Number(digits) / 1000;
  if (!Number.isFinite(n)) return "";
  return n.toFixed(3);
}

function parseDateBR(raw: string): Date | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  let yy = Number(m[3]);
  if (m[3].length === 2) yy = yy <= 69 ? 2000 + yy : 1900 + yy;

  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}

function parseTime(raw: string): { hh: number; mm: number; ss: number } | null {
  const v = (raw || "").trim();
  if (!v) return null;

  const m = v.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? "0");

  if (hh > 23 || mm > 59 || ss > 59) return null;
  return { hh, mm, ss };
}

function parsePesoMasked(raw: string): number | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const n = Number.parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatDateBR(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

function safePathPart(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 40);
}

function uuid() {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function fileToDataURL(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function blobToDataURL(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao converter imagem."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

/**
 * ✅ FIX DO 413:
 * Comprime/redimensiona a imagem antes de mandar pro OCR (base64).
 * Mantém o upload original para o Supabase.
 */
async function makeOcrDataUrlFromImage(file: File): Promise<{ dataUrl: string; note: string | null }> {
  if (!file.type.startsWith("image/")) {
    return { dataUrl: await fileToDataURL(file), note: null };
  }

  if (file.size <= 900_000) {
    return { dataUrl: await fileToDataURL(file), note: null };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Falha ao carregar a imagem para compressão."));
      i.src = url;
    });

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;

    const maxW = 1600;
    const maxH = 1600;
    const scale = Math.min(1, maxW / w, maxH / h);

    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { dataUrl: await fileToDataURL(file), note: null };
    }

    ctx.drawImage(img, 0, 0, cw, ch);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao comprimir a imagem."))), "image/jpeg", 0.82);
    });

    const dataUrl = await blobToDataURL(blob);
    return {
      dataUrl,
      note: `Foto otimizada para OCR (${Math.round(file.size / 1024)}KB → ${Math.round(blob.size / 1024)}KB).`,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function normalizeVehicle(v: string | null) {
  const s = (v || "").trim();
  if (!s) return "";
  return s.toUpperCase();
}

function normalizeText(v: string | null) {
  return (v || "").trim();
}

/**
 * ✅ Normaliza OBRA/DESTINO para evitar duplicidade
 */
function normalizeObraName(v: string | null) {
  let s = (v || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s*-\s*([A-Za-z]{2})$/, (_m, uf) => ` - ${String(uf).toUpperCase()}`);
  return s;
}

function normalizeDateFromOcrToMasked(v: string | null) {
  return (v || "").trim();
}
function normalizeTimeFromOcrToMasked(v: string | null) {
  return (v || "").trim();
}
function normalizePesoFromOcrToMasked(v: any) {
  if (v === null || v === undefined) return "";
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return Number(n).toFixed(3);
}

function fmtT(v: number | null | undefined) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(3);
}

function fmtQtd(v: number | null | undefined) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return String(Math.trunc(n));
}

function fmtTonBR(v: number | null | undefined, digits: number) {
  if (v === null || v === undefined) return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function looksLikePlate(raw: string) {
  const s = (raw || "").trim().toUpperCase();
  if (!s) return false;
  const compact = s.replace(/\s+/g, "");

  // Mercosul: ABC1D23 (ou ABC-1D23)
  if (/^[A-Z]{3}-?\d[A-Z]\d{2}$/.test(compact)) return true;

  // Padrão antigo: ABC-1234
  if (/^[A-Z]{3}-\d{4}$/.test(compact)) return true;

  // OCR ruim
  if (/^[A-Z]{2}\d-?\d[A-Z0-9]\d{2}$/.test(compact)) return true;

  return false;
}

function isHeaderLine(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return true;

  if (u === "C") return true;
  if (u === "D") return true;

  // cabeçalhos comuns
  if (
    /(GPA\s+ENGENHARIA\s+E\s+CONSTRU|TICKET\s+DE\s+PES|TICKET\s+DE\s+PESA\s*GEM|PESAGEM|PESAGEM\s+FINAL|PESAGEM\s+INICIAL|PESAGEM\s+FINAL\s+OK|PESA\s*GEM|PESA\s*GEM\s+FINAL\s+OK|PESA\s*GEM\s+INICIAL|VEIC\/CAVALO|MOTORISTA|ASSINATURA|RECEBIMENTO|INSPE|OBS\.?|UA-\d+|N°|TICKET\s+N|P\.\s*GERAL|P\.\s*OBRA)/i.test(
      u
    )
  )
    return true;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(u)) return true;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(u)) return true;

  // números soltos não são "header", mas não servem como texto
  if (/^\d+$/.test(u)) return true;

  return false;
}

function isLikelyMaterial(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return false;
  if (u === "CARRETA") return false;
  if (u.length <= 2) return false;
  if (looksLikePlate(u)) return false;

  if (/(BRITA|P[ÓO]\s*BRITA|PO\s*BRITA|PÓ\s*DE\s*BRITA|CBUQ|MASSA|CAP|RR|OGR|EMULS)/i.test(u)) return true;

  return false;
}

function isBadDestino(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return true;
  if (u.length <= 2) return true;
  if (u === "C") return true;
  if (u === "CARRETA") return true;
  if (looksLikePlate(u)) return true;
  return false;
}

function isBadMaterial(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return true;
  if (u === "CARRETA") return true;
  if (u.length <= 2) return true;
  return false;
}

function isFetzOrigem(s: string) {
  return /FETZ/i.test((s || "").trim());
}

function isPatioLike(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return false;
  return /PATIO|PÁTIO/i.test(u) || /FETZ\+FRETE/i.test(u) || /USINA\s*\(FETZ\+FRETE\)/i.test(u);
}

function normalizeMaterialForMsg(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return "";
  if (/P[ÓO]\s*DE\s*BRITA/.test(u)) return "PO BRITA";
  if (/P[ÓO]\s*BRITA/.test(u)) return "PO BRITA";
  if (/PO\s*BRITA/.test(u)) return "PO BRITA";
  // ✅ evita classificar "BRITA 01" como "BRITA 0" (ex.: "BRITA 01" não casa com \b)
  if (/BRITA\s*0\b|BRITA\s*ZERO/.test(u)) return "BRITA ZERO";
  if (/BRITA\s*01|BRITA\s*1|BRITA\s*UM/.test(u)) return "BRITA 01";
  return (s || "").trim();
}

/**
 * ✅ ENTRADA: extrai do OCR bruto (resistente a variações tipo "C" no começo)
 * - origem: marcador 3
 * - destino: marcador 1
 * - material: marcador 4 (ou varredura por BRITA/PÓ BRITA)
 * - peso: número logo após a ÚLTIMA "PESAGEM INICIAL" (peso líquido)
 */
function fixEntradaFromRaw(raw: string): { origem?: string; destino?: string; material?: string; peso?: string } | null {
  const lines = String(raw || "")
    .split(/\r?\n/g)
    .map((x) => (x || "").trim())
    .filter(Boolean);

  if (!lines.length) return null;

  // pega valores quando o OCR junta "3 FETZ MINERADORA" na mesma linha
  const markerInline: Record<string, string> = {};
  for (const ln of lines) {
    const m = ln.match(/^([134])\s+(.+)$/);
    if (m) {
      const k = m[1];
      const v = (m[2] || "").trim();
      if (v && !isHeaderLine(v)) markerInline[k] = v;
    }
  }

  const findExactMarker = (mk: string) => lines.findIndex((x) => (x || "").trim() === mk);

  const nextMeaningful = (idx: number) => {
    for (let j = idx + 1; j < lines.length; j++) {
      const s = (lines[j] || "").trim();
      if (!s) continue;
      if (/^\d+$/.test(s)) continue;
      if (looksLikePlate(s)) continue;
      if (isHeaderLine(s)) continue;
      return s;
    }
    return null;
  };

  // origem/destino/material
  let origem: string | null = markerInline["3"] || null;
  let destino: string | null = markerInline["1"] || null;
  let material: string | null = markerInline["4"] || null;

  if (!origem) {
    const i3 = findExactMarker("3");
    if (i3 >= 0) origem = nextMeaningful(i3);
  }

  if (!destino) {
    const i1 = findExactMarker("1");
    if (i1 >= 0) destino = nextMeaningful(i1);
  }

  // fallback destino: achar "GPA ENGENHARIA" em qualquer lugar
  if (!destino) {
    const cand = lines.find((x) => /GPA\s+ENGENHARIA/i.test(x) && !isHeaderLine(x));
    if (cand) destino = cand.trim();
  }

  // material: garantir que é material
  if (material && !isLikelyMaterial(material)) material = null;

  if (!material) {
    const i4 = findExactMarker("4");
    if (i4 >= 0) {
      const cand = nextMeaningful(i4);
      if (cand && isLikelyMaterial(cand)) material = cand;
    }
  }

  if (!material) {
    const cand = lines.find((x) => isLikelyMaterial(x));
    if (cand) material = cand;
  }

  // ✅ peso: tenta achar 2 ou 3 pesos e calcula líquido (ex.: 17.640 / 46.980 / 29.340)
  let peso: string | null = null;

  const parseWeightsFromLines = (arr: string[]) => {
    const out: number[] = [];
    for (const ln of arr) {
      const s = (ln || "").trim();
      if (!s) continue;

      const it = s.matchAll(/(\d{1,3}[.,]\d{3})/g);
      for (const m of it as any) {
        const num = Number.parseFloat(String(m[1]).replace(",", "."));
        if (Number.isFinite(num)) out.push(num);
      }
    }
    return out;
  };

  const pickNetFromWeights = (ws: number[]) => {
    const vals = ws.filter((x) => Number.isFinite(x) && x > 0);
    if (vals.length < 2) return null;

    const uniq: number[] = [];
    for (const v of vals) {
      if (!uniq.some((u) => Math.abs(u - v) < 0.001)) uniq.push(v);
    }

    const min = Math.min(...uniq);
    const max = Math.max(...uniq);
    const diff = Math.max(0, max - min);

    const tol = 0.01; // ~10 kg
    const cand = uniq.find((v) => Math.abs(v - diff) <= tol);
    const chosen = cand ?? diff;

    if (!Number.isFinite(chosen) || chosen <= 0) return null;
    return chosen;
  };

  const timeIdx = (() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const s = (lines[i] || "").trim();
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return i;
    }
    return -1;
  })();

  let weights: number[] = [];

  if (timeIdx >= 0) {
    let end = lines.length;
    for (let i = timeIdx + 1; i < lines.length; i++) {
      const u = (lines[i] || "").trim().toUpperCase();
      if (!u) continue;

      if (/^(OBS\.?|RECEBIMENTO|ASSINATURA|MOTORISTA|TICKET|UA-\d+|P\.?\s*GERAL|P\.?\s*OBRA)/i.test(u)) {
        end = i;
        break;
      }
    }
    weights = parseWeightsFromLines(lines.slice(timeIdx, end));
  }

  if (weights.length < 2) weights = parseWeightsFromLines(lines);

  const net = pickNetFromWeights(weights);
  if (net !== null) peso = net.toFixed(3);

  const any = Boolean(origem || destino || material || peso);
  if (!any) return null;

  const out: any = {};
  if (origem) out.origem = origem;
  if (destino) out.destino = destino;
  if (material) out.material = material;
  if (peso) out.peso = peso;
  return out;
}

function resolveEntradaObra(origemVal: string, destinoVal: string) {
  const d = normalizeObraName(destinoVal);

  // ✅ NOVA REGRA:
  // - se for pátio (qualquer variação), salva/mostra como GPA ENGENHARIA
  // - entradas da FETZ também ficam como GPA ENGENHARIA
  if (isPatioLike(d)) return "GPA ENGENHARIA";
  if (isFetzOrigem((origemVal || "").trim())) return "GPA ENGENHARIA";

  return d;
}

function materialVariantsForLookup(mat: string) {
  const m = normalizeMaterialForMsg(mat);
  const u = m.toUpperCase();

  const out = new Set<string>();
  if (u) out.add(u);

  if (u === "PO BRITA") {
    out.add("PÓ BRITA");
    out.add("PO BRITA");
    out.add("PÓ DE BRITA");
  }

  if (u === "BRITA ZERO") {
    out.add("BRITA ZERO");
    out.add("BRITA 0");
  }

  if (u === "BRITA 01") {
    out.add("BRITA 01");
    out.add("BRITA 1");
    out.add("BRITA UM");
  }

  return Array.from(out);
}

// ✅ ENTRADA: lookup dos planos ativos (por origem+material) e resumo por plano
// (não mexe em SAÍDA)
async function loadEntradaPlansForTicket(origemVal: string, matVal: string, dateISO: string): Promise<EntradaPlan[]> {
  try {
    const matCanon = normalizeMaterialForMsg(matVal);
    const mats = Array.from(new Set([matCanon, ...materialVariantsForLookup(matCanon)])).filter(Boolean);

    if (!mats.length) return [];

    let q = supabase
      .from("material_entrada_plan")
      .select("id,origem,obra,material,pedido_t,inicio_em,offset_t,ativo")
      .eq("ativo", true)
      .lte("inicio_em", dateISO)
      .in("material", mats)
      .order("inicio_em", { ascending: false });

    if (isFetzOrigem((origemVal || "").trim())) q = q.ilike("origem", "%FETZ%");
    else q = q.ilike("origem", `%${(origemVal || "").trim()}%`);

    const { data, error } = await q;
    if (error) return [];

    const rows = Array.isArray(data) ? data : [];
    return rows as any;
  } catch {
    return [];
  }
}

async function loadEntradaPlanResumoByIds(planIds: number[]): Promise<Record<number, EntradaPlanResumo>> {
  try {
    const uniq = Array.from(new Set((planIds || []).filter((x) => Number.isFinite(Number(x))))) as number[];
    if (!uniq.length) return {};

    const { data, error } = await supabase
      .from("material_entrada_resumo_por_plano_v")
      .select("plan_id,origem,obra,produto,pedido,volume_entr,saldo_rest")
      .in("plan_id", uniq);

    if (error) return {};

    const out: Record<number, EntradaPlanResumo> = {};
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows as any[]) {
      if (r?.plan_id !== null && r?.plan_id !== undefined) out[Number(r.plan_id)] = r as any;
    }
    return out;
  } catch {
    return {};
  }
}

function buildWhatsappMessage(p: {
  tipo: TicketTipo;
  veiculo: string;
  origem: string;
  obra: string;
  material: string;
  oc: string | null;
  dataISO: string;
  horarioISO: string;
  pesoNum: number;
  savedId?: number | null;
  savedIds?: number[] | null;
  resumo?: OcResumo | null;
  acum?: Acumulados | null;
  entradaPlanRows?: EntradaPlanResumo[] | null;
  entradaAlloc?: EntradaAlloc[] | null;
}) {
  const {
    tipo,
    veiculo,
    origem,
    obra,
    material,
    oc,
    dataISO,
    horarioISO,
    pesoNum,
    savedId,
    savedIds,
    resumo,
    acum,
    entradaPlanRows,
    entradaAlloc,
  } = p;

  const dateBR = (() => {
    const [y, m, d] = dataISO.split("-");
    return `${d}/${m}/${y}`;
  })();

  const unidadeQtd = tipo === "SAIDA" ? "CB" : "tickets";

  const idsLabel = savedIds && savedIds.length ? savedIds.join(" / ") : savedId ?? "-";

  let msg =
    `✅ Ticket de ${tipo}\n` +
    `ID: ${idsLabel}\n` +
    `Veículo: ${veiculo}\n` +
    `Data/Hora: ${dateBR} ${horarioISO}\n` +
    `Origem: ${origem}\n` +
    `Obra: ${obra}\n` +
    `Material: ${material}\n` +
    `Ordem de Compra: ${oc ? oc : "-"}\n` +
    `Peso (t): ${pesoNum.toFixed(3)}\n`;

  // ✅ SAÍDA: mantém acumulado e controle OC
  if (tipo === "SAIDA") {
    if (acum) {
      msg += `\n📅 Acumulado Obra *${obra}*\n`;
      msg += `Dia (com esta): ${fmtQtd(acum.dia_qtd)} ${unidadeQtd} • ${fmtT(acum.dia_total_t)} t\n`;
      msg += `Semana (Seg-Dom): ${fmtQtd(acum.semana_qtd)} ${unidadeQtd} • ${fmtT(acum.semana_total_t)} t\n`;
      msg += `Mês: ${fmtQtd(acum.mes_qtd)} ${unidadeQtd} • ${fmtT(acum.mes_total_t)} t\n`;
    }

    if (resumo) {
      const ilimitado = Boolean(resumo.ilimitado);
      msg += `\n📊 Controle (Obra/OC/Material)\n`;

      if (ilimitado) {
        msg += `Quantidade total: ILIMITADO\n`;
        msg += `Saldo: ILIMITADO\n`;
      } else {
        msg += `Entrada total: ${fmtT(resumo.entrada_t)} t\n`;
        msg += `Saída total: ${fmtT(resumo.saida_t)} t\n`;
        msg += `Quantidade total: ${fmtT(resumo.total_t)} t\n`;
        msg += `Saldo a entregar: ${fmtT(resumo.saldo_t)} t\n`;
      }
    }

    return msg;
  }

  // ✅ ENTRADA: usa resumo por plano (material_entrada_resumo_por_plano_v)
  // Ticket fica em GPA ENGENHARIA; o controle vem do(s) plano(s) (PÁTIO normal / PERMUTA)
  const rows = (entradaPlanRows || []).slice();

  // Se foi dividido (permuta + normal no mesmo caminhão), mostra quanto foi para cada plano
  if (entradaAlloc && entradaAlloc.length > 1) {
    msg += `\n🧩 Consumo (dividido)\n`;
    for (const a of entradaAlloc) {
      msg += `- ${fmtTonBR(a.peso, 2)} ton → ${a.obra}${a.over ? " (⚠️ excedeu saldo)" : ""}\n`;
    }
  }

  if (rows.length) {
    rows.sort((a, b) => String(a.obra || "").localeCompare(String(b.obra || "")));

    for (const r of rows) {
      const obraMsg = (r.obra || "").trim() || (isFetzOrigem((origem || "").trim()) ? PATIO_FETZ_OBRA : obra);
      const matMsg = normalizeMaterialForMsg((r.produto || "").trim() || material);

      const pedido = r.pedido ?? null;
      const entradaComEsta = r.volume_entr ?? null;
      const saldo = r.saldo_rest ?? null;

      const temPedido = pedido !== null && Number.isFinite(Number(pedido)) && Number(pedido) > 0.0001;

      msg += `\nObra: ${obraMsg}\n`;
      msg += `Material: ${matMsg}\n`;

      if (temPedido) msg += `Quantidade total: ${fmtTonBR(pedido, 0)} ton\n`;
      else msg += `Quantidade total: -\n`;

      if (entradaComEsta !== null && Number.isFinite(Number(entradaComEsta))) {
        msg += `Entrada total com esta: ${fmtTonBR(entradaComEsta, 2)} ton\n`;
      } else {
        msg += `Entrada total com esta: -\n`;
      }

      if (temPedido && saldo !== null && Number.isFinite(Number(saldo))) {
        msg += `A entregar: ${fmtTonBR(saldo, 2)} ton\n`;
      } else {
        msg += `A entregar: -\n`;
      }
    }

    return msg;
  }

  // fallback: sem plano/resumo (mostra só o ticket)
  return msg;
}

export default function MaterialTicketNovoPage() {
  const [tipo, setTipo] = useState<TicketTipo>("SAIDA");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [veiculo, setVeiculo] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState(""); // obra/destino
  const [material, setMaterial] = useState("");
  const [oc, setOc] = useState("");

  const [dataBr, setDataBr] = useState("");
  const [hora, setHora] = useState("");
  const [peso, setPeso] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [ocrRaw, setOcrRaw] = useState<string | null>(null);
  const [ocrNote, setOcrNote] = useState<string | null>(null);

  const [lastShareFile, setLastShareFile] = useState<File | null>(null);
  const [lastPayload, setLastPayload] = useState<{
    tipo: TicketTipo;
    veiculo: string;
    origem: string;
    obra: string;
    material: string;
    oc: string | null;
    dataISO: string;
    horarioISO: string;
    pesoNum: number;
    id: number;
  } | null>(null);

  const [lastResumo, setLastResumo] = useState<OcResumo | null>(null);
  const [lastAcum, setLastAcum] = useState<Acumulados | null>(null);
  const [lastEntradaPlanRows, setLastEntradaPlanRows] = useState<EntradaPlanResumo[] | null>(null);
  const [lastEntradaAlloc, setLastEntradaAlloc] = useState<EntradaAlloc[] | null>(null);
  const [lastSavedIds, setLastSavedIds] = useState<number[] | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const parsed = useMemo(() => {
    const d = parseDateBR(dataBr);
    const t = parseTime(hora);
    const p = parsePesoMasked(peso);

    const dataISO = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
      : null;

    const timeISO = t ? `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}:${String(t.ss).padStart(2, "0")}` : null;

    return {
      dataOk: Boolean(d),
      horaOk: Boolean(t),
      pesoOk: p !== null,
      dataISO,
      timeISO,
      pesoNum: p,
    };
  }, [dataBr, hora, peso]);

  function validateBasic(): boolean {
    setError(null);
    setSavedMsg(null);
    setSavedId(null);

    if (!file) return setError("Tire/Envie a foto do ticket."), false;
    if (file.type?.includes("pdf")) return setError("OCR ainda não suporta PDF. Envie imagem (jpg/png/webp)."), false;

    if (!veiculo.trim()) return setError("Preencha o veículo."), false;
    if (!origem.trim()) return setError("Preencha a origem."), false;
    if (!destino.trim()) return setError("Preencha a obra/destino."), false;
    if (!material.trim()) return setError("Preencha o material."), false;
    if (!parsed.dataOk) return setError("Data inválida. Use dd/mm/aa ou dd/mm/aaaa."), false;
    if (!parsed.horaOk) return setError("Horário inválido. Use hh:mm ou hh:mm:ss."), false;
    if (!parsed.pesoOk) return setError("Peso inválido. Digite só números (ex.: 2720 → 2.720)."), false;

    return true;
  }

  async function loadResumo(obra: string, ocVal: string | null, mat: string): Promise<OcResumo | null> {
    try {
      let q = supabase
        .from("material_oc_saldo_v")
        .select("plan_id,obra,oc,material,ilimitado,total_t,entrada_t,saida_t,saldo_t")
        .ilike("obra", obra.trim())
        .ilike("material", mat.trim())
        .order("plan_id", { ascending: false })
        .limit(1);

      if (ocVal) q = q.eq("oc", ocVal);
      else q = q.is("oc", null);

      const { data, error } = await q.maybeSingle();
      if (error) return null;
      return (data as any) ?? null;
    } catch {
      return null;
    }
  }

  async function loadAcumulados(tipoVal: TicketTipo, obraVal: string, ocVal: string | null, matVal: string, dataISO: string): Promise<Acumulados | null> {
    try {
      const { data, error } = await supabase.rpc("material_ticket_acumulados", {
        p_tipo: tipoVal,
        p_obra: obraVal,
        p_oc: ocVal,
        p_material: matVal,
        p_data: dataISO,
      });

      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      return (row as any) ?? null;
    } catch {
      return null;
    }
  }

  // ✅ quando faltar plano, cadastra como ILIMITADO (obra+oc+material) — SÓ PRA SAÍDA
  async function ensurePlanIlimitado(obraVal: string, ocVal: string | null, matVal: string): Promise<boolean> {
    try {
      const obraTrim = normalizeObraName(obraVal);
      const matTrim = (matVal || "").trim();

      if (!obraTrim || !matTrim) return false;
      if (looksLikePlate(obraTrim)) return false;

      let q = supabase.from("material_oc_plan").select("id").ilike("obra", obraTrim).ilike("material", matTrim).limit(1);

      if (ocVal) q = q.eq("oc", ocVal);
      else q = q.is("oc", null);

      const existing = await q.maybeSingle();
      if (!existing.error && existing.data?.id) return false;

      const ins = await supabase
        .from("material_oc_plan")
        .insert({
          obra: obraTrim,
          oc: ocVal,
          material: matTrim,
          ilimitado: true,
          total_t: null,
          tolerancia_t: null,
        })
        .select("id")
        .single();

      if (ins.error) return false;
      return true;
    } catch {
      return false;
    }
  }

  async function handleOcr() {
    setError(null);
    setSavedMsg(null);
    setSavedId(null);
    setOcrNote(null);

    if (!file) {
      setError("Tire/Envie a foto do ticket para ler via OCR.");
      return;
    }
    if (file.type?.includes("pdf")) {
      setError("OCR ainda não suporta PDF. Envie imagem (jpg/png/webp).");
      return;
    }

    setOcrLoading(true);
    try {
      const { dataUrl, note } = await makeOcrDataUrlFromImage(file);
      setOcrNote(note);

      const res = await fetch("/api/vision/material-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });

      if (res.status === 413) {
        throw new Error(
          "Foto muito grande para OCR. O app tentou otimizar, mas ainda excedeu o limite. Tire a foto mais de longe (menos resolução) e tente novamente."
        );
      }

      const js = await res.json().catch(() => null);
      if (!res.ok || !js?.ok) {
        throw new Error(js?.error || "OCR falhou.");
      }

      setOcrRaw(js?.raw || null);

      const f = js?.fields || {};

      let vVal = normalizeVehicle(f.veiculo || null);
      let oVal = normalizeText(f.origem || null);
      let dVal = normalizeObraName(f.destino || null);
      let mVal = normalizeText(f.material || null);
      let dtVal = normalizeDateFromOcrToMasked(f.data_br || null);
      let hrVal = normalizeTimeFromOcrToMasked(f.horario || null);
      let pVal = normalizePesoFromOcrToMasked(f.peso_mask ?? f.peso_t ?? null);

      // ✅ ENTRADA: sempre tenta corrigir pelos marcadores do RAW (3/1/4 e peso líquido)
      if (tipo === "ENTRADA" && js?.raw) {
        const fixed = fixEntradaFromRaw(String(js.raw));
        if (fixed) {
          if (fixed.origem && !isHeaderLine(fixed.origem)) oVal = fixed.origem;
          if (fixed.destino && !isBadDestino(fixed.destino)) dVal = fixed.destino;
          if (fixed.material && isLikelyMaterial(fixed.material)) mVal = fixed.material;

          const pNum = parsePesoMasked(pVal);
          if (fixed.peso && (pNum === null || pNum <= 0)) pVal = fixed.peso;
        }

        // material normalizado (evita "PÓ DE BRITA" vs "PO BRITA")
        if (mVal) mVal = normalizeMaterialForMsg(mVal);

        // ENTRADA FETZ: default do “estoque” é o PÁTIO (pra bater com a view de saldo)
        if (isFetzOrigem(oVal)) {
          dVal = resolveEntradaObra(oVal, dVal);
        }
      }

      if (vVal) setVeiculo(vVal);
      if (oVal) setOrigem(oVal);

      // destino: se vier ruim tipo "C", não seta; mas se ENTRADA/FETZ ele já virou PÁTIO
      if (dVal && !isBadDestino(dVal)) setDestino(dVal);

      // material: evita cair em "CARRETA"
      if (mVal && !isBadMaterial(mVal)) setMaterial(mVal);

      if (dtVal) setDataBr(dtVal);
      if (hrVal) setHora(hrVal);
      if (pVal) setPeso(pVal);

      setSavedMsg("OCR aplicado. Confira e ajuste se necessário.");
    } catch (e: any) {
      setError(e?.message || "Erro ao rodar OCR.");
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleSave() {
    if (!validateBasic()) return;

    setSaving(true);
    setError(null);
    setLastResumo(null);
    setLastAcum(null);
    setLastEntradaPlanRows(null);
    setLastEntradaAlloc(null);
    setLastSavedIds(null);

    try {
      const dateISO = parsed.dataISO!;
      const timeISO = parsed.timeISO!;
      const pesoNum = parsed.pesoNum!;

      const ext = extFromFile(file!);
      const veic = safePathPart(veiculo) || "veiculo";
      const baseName = safePathPart(file!.name.replace(/\.[^.]+$/, "")) || "ticket";
      const id = uuid();

      const storagePath = `material/${dateISO}/${veic}-${baseName}-${id}.${ext}`;

      const up = await supabase.storage.from("tickets").upload(storagePath, file!, {
        upsert: false,
        cacheControl: "3600",
        contentType: file!.type || "application/octet-stream",
      });
      if (up.error) throw new Error(`Storage upload falhou: ${up.error.message}`);

      const ocVal = oc.trim() ? oc.trim() : null;

      // ✅ ENTRADA: ticket sempre fica em GPA ENGENHARIA (sua regra)
      const obraVal = tipo === "ENTRADA" ? resolveEntradaObra(origem.trim(), destino) : normalizeObraName(destino);
      const matCanon = normalizeMaterialForMsg(material.trim());

      // ---------------------------------------------------------
      // ✅ ENTRADA: atribui plano(s) e grava entrada_plan_id
      // - se PERMUTA estiver ativa e com saldo, consome primeiro
      // - se precisar, divide o caminhão em 2 lançamentos
      // - SAÍDA permanece intocada
      // ---------------------------------------------------------
      if (tipo === "ENTRADA") {
        const plans = await loadEntradaPlansForTicket(origem.trim(), matCanon, dateISO);

        let allocs: EntradaAlloc[] = [];
        if (plans.length) {
          const resumoByBefore = await loadEntradaPlanResumoByIds(plans.map((p) => Number(p.id)));

          let remaining = pesoNum;

          // plans já vêm ordenados por inicio_em desc
          for (const p of plans) {
            if (remaining <= 0.0001) break;

            const r = resumoByBefore[Number(p.id)];
            const saldoRaw = r?.saldo_rest ?? null;
            const saldo = saldoRaw !== null && Number.isFinite(Number(saldoRaw)) ? Number(saldoRaw) : 0;

            if (saldo <= 0.0001) continue;

            const take = Math.min(remaining, saldo);
            if (take > 0.0001) {
              allocs.push({
                plan_id: Number(p.id),
                obra: String(p.obra || "").trim() || "-",
                peso: take,
              });
              remaining -= take;
            }
          }

          if (remaining > 0.0001) {
            // sobra vai pro plano mais antigo (normal) — evita travar o lançamento
            const fallback = plans[plans.length - 1];
            allocs.push({
              plan_id: fallback?.id ? Number(fallback.id) : null,
              obra: String(fallback?.obra || "").trim() || "-",
              peso: remaining,
              over: true,
            });
            remaining = 0;
          }
        }

        // sem planos -> grava sem plan_id (não deve acontecer no seu caso)
        if (!allocs.length) {
          allocs = [{ plan_id: null, obra: isFetzOrigem(origem.trim()) ? PATIO_FETZ_OBRA : obraVal, peso: pesoNum }];
        }

        const rowsToInsert = allocs.map((a) => ({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          destino: obraVal,
          obra: obraVal,
          material: matCanon,
          oc: ocVal,
          data: dateISO,
          horario: timeISO,
          peso_t: a.peso,
          entrada_plan_id: a.plan_id,
          arquivo_path: storagePath,
          arquivo_nome: file!.name,
          arquivo_mime: file!.type || null,
          arquivo_size: file!.size,
        }));

        const insAll = await supabase.from("material_tickets").insert(rowsToInsert).select("id");
        if (insAll.error) throw new Error(`Insert falhou: ${insAll.error.message}`);

        const idsInserted: number[] = (Array.isArray(insAll.data) ? insAll.data : [])
          .map((r: any) => Number(r?.id))
          .filter((x: any) => Number.isFinite(Number(x)) && Number(x) > 0);

        const firstId = idsInserted[0] ?? null;
        setSavedId(firstId);
        setLastSavedIds(idsInserted);
        setLastEntradaAlloc(allocs);

        // acumulados (não vai no WhatsApp de ENTRADA, mas mantém pra debug)
        const acum = await loadAcumulados(tipo, obraVal, ocVal, matCanon, dateISO);
        setLastAcum(acum);

        // resumo por plano (para mensagem do WhatsApp)
        const planIdsMsg = plans.map((p) => Number(p.id)).filter((x) => Number.isFinite(Number(x)));
        const resumoByAfter = await loadEntradaPlanResumoByIds(planIdsMsg);
        const rows = Object.values(resumoByAfter);
        setLastEntradaPlanRows(rows.length ? rows : null);

        setSavedMsg(idsInserted.length > 1 ? "Salvo com sucesso! (Entrada dividida em 2 lançamentos)" : "Salvo com sucesso!");

        if (firstId) {
          setLastPayload({
            tipo,
            veiculo: veiculo.trim(),
            origem: origem.trim(),
            obra: obraVal,
            material: matCanon,
            oc: ocVal,
            dataISO: dateISO,
            horarioISO: timeISO,
            pesoNum: pesoNum, // peso total (mesmo se dividido)
            id: firstId,
          });
        } else {
          setLastPayload(null);
        }

        setLastShareFile(file!);

        setFile(null);
        setPreviewUrl(null);
        setOcrRaw(null);
        setOcrNote(null);
        return;
      }

      // ---------------------------------------------------------
      // ✅ SAÍDA: NÃO ALTERAR (intocada)
      // ---------------------------------------------------------
      const ins = await supabase
        .from("material_tickets")
        .insert({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          destino: obraVal,
          obra: obraVal,
          material: matCanon,
          oc: ocVal,
          data: dateISO,
          horario: timeISO,
          peso_t: pesoNum,
          arquivo_path: storagePath,
          arquivo_nome: file!.name,
          arquivo_mime: file!.type || null,
          arquivo_size: file!.size,
        })
        .select("id")
        .single();

      if (ins.error) throw new Error(`Insert falhou: ${ins.error.message}`);

      const newId = ins.data?.id ?? null;
      setSavedId(newId);

      const acum = await loadAcumulados(tipo, obraVal, ocVal, matCanon, dateISO);
      setLastAcum(acum);

      let resumo = await loadResumo(obraVal, ocVal, matCanon);
      let createdPlan = false;

      if (!resumo) {
        createdPlan = await ensurePlanIlimitado(obraVal, ocVal, matCanon);
        if (createdPlan) {
          resumo = await loadResumo(obraVal, ocVal, matCanon);
        }
      }

      setLastResumo(resumo);

      if (createdPlan) {
        setSavedMsg("Salvo com sucesso! Plano cadastrado como ILIMITADO (ajuste depois se necessário).");
      } else if (!resumo) {
        setSavedMsg("Salvo com sucesso! ⚠️ Plano não encontrado (confira Obra/Material e cadastre no plano).");
      } else {
        setSavedMsg("Salvo com sucesso!");
      }

      if (newId) {
        setLastPayload({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          obra: obraVal,
          material: matCanon,
          oc: ocVal,
          dataISO: dateISO,
          horarioISO: timeISO,
          pesoNum,
          id: newId,
        });
      } else {
        setLastPayload(null);
      }

      setLastShareFile(file!);

      setFile(null);
      setPreviewUrl(null);
      setOcrRaw(null);
      setOcrNote(null);
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function handleShareWhatsApp() {
    if (!lastPayload) return;

    const msg = buildWhatsappMessage({
      tipo: lastPayload.tipo,
      veiculo: lastPayload.veiculo,
      origem: lastPayload.origem,
      obra: lastPayload.obra,
      material: lastPayload.material,
      oc: lastPayload.oc,
      dataISO: lastPayload.dataISO,
      horarioISO: lastPayload.horarioISO,
      pesoNum: lastPayload.pesoNum,
      savedId: lastPayload.id,
      resumo: lastResumo,
      acum: lastAcum,
      savedIds: lastSavedIds,
      entradaPlanRows: lastEntradaPlanRows,
      entradaAlloc: lastEntradaAlloc,
    });

    try {
      const navAny: any = navigator as any;

      if (navAny?.share && lastShareFile) {
        const withFile = { files: [lastShareFile] };
        if (!navAny.canShare || navAny.canShare(withFile)) {
          await navAny.share({
            title: "Ticket de material",
            text: msg,
            files: [lastShareFile],
          });
          return;
        }
      }
    } catch {
      // fallback abaixo
    }

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  const styles: Record<string, CSSProperties> = {
    label: {
      fontSize: 12,
      fontWeight: 800,
      color: "var(--gp-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      display: "block",
      marginBottom: 6,
    },
    input: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 16,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    select: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 16,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    btnPrimary: {
      borderRadius: 14,
      border: "1px solid #fb7185",
      background: saving ? "linear-gradient(180deg, #94a3b8, #64748b)" : "linear-gradient(180deg, #ff4b2b, #fb7185)",
      color: "#fff",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: saving ? "not-allowed" : "pointer",
      fontSize: 15,
      boxShadow: saving ? "none" : "0 14px 26px rgba(255, 75, 43, 0.20)",
      opacity: saving ? 0.8 : 1,
      width: "100%",
    },
    btnGhost: {
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: ocrLoading ? "#e2e8f0" : "#ffffff",
      color: "#0f172a",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: ocrLoading ? "not-allowed" : "pointer",
      fontSize: 15,
      width: "100%",
    },
    btnShare: {
      borderRadius: 14,
      border: "1px solid #bbf7d0",
      background: "#22c55e",
      color: "#fff",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: "pointer",
      fontSize: 15,
      width: "100%",
    },
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 },
  };

  const unidadeQtd = tipo === "SAIDA" ? "CB" : "tickets";

  return (
    <div className="page-root">
      <div className="page-container">
        <header className="page-header" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{ width: 110, height: 110, objectFit: "contain", border: "none", background: "transparent" }}
          />
          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main">Materiais • Ticket</div>
            <div className="brand-text-sub">Tirar foto • OCR • Salvar • WhatsApp</div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo ticket</div>
              <div className="section-subtitle">Tire a foto pelo celular, rode o OCR, ajuste e salve.</div>
            </div>
          </div>

          {error ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#991b1b",
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          {savedMsg ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#166534",
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {savedMsg} {savedId ? <>ID: <b>{savedId}</b></> : null}

              {/* SAÍDA: mostra acumulados + resumo */}
              {tipo === "SAIDA" && lastAcum ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#14532d", lineHeight: 1.35 }}>
                  <b>Dia:</b> {fmtQtd(lastAcum.dia_qtd)} {unidadeQtd} • <b>Total no dia:</b> {fmtT(lastAcum.dia_total_t)} t
                  <br />
                  <b>Semana (Seg-Dom):</b> {fmtQtd(lastAcum.semana_qtd)} {unidadeQtd} • <b>Total:</b> {fmtT(lastAcum.semana_total_t)} t
                  <br />
                  <b>Mês:</b> {fmtQtd(lastAcum.mes_qtd)} {unidadeQtd} • <b>Total:</b> {fmtT(lastAcum.mes_total_t)} t
                </div>
              ) : null}

              {tipo === "SAIDA" && lastResumo ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#14532d" }}>
                  <b>Controle:</b>{" "}
                  {lastResumo.ilimitado ? `ILIMITADO` : `Total: ${fmtT(lastResumo.total_t)} t • Saldo: ${fmtT(lastResumo.saldo_t)} t`}
                </div>
              ) : null}

              {/* ENTRADA: mostra controle de pedido/saldo (por plano) */}
              {tipo === "ENTRADA" && lastEntradaPlanRows && lastEntradaPlanRows.length ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#14532d", lineHeight: 1.35 }}>
                  {lastEntradaPlanRows
                    .slice()
                    .sort((a, b) => String(a.obra || "").localeCompare(String(b.obra || "")))
                    .map((r) => (
                      <div key={r.plan_id} style={{ marginTop: 6 }}>
                        <b>Obra:</b> {r.obra ?? "-"}
                        <br />
                        <b>Material:</b> {normalizeMaterialForMsg(r.produto ?? "-")}
                        <br />
                        <b>Pedido:</b> {r.pedido !== null ? `${fmtTonBR(r.pedido, 0)} ton` : "-"}
                        <br />
                        <b>Entrada total:</b> {r.volume_entr !== null ? `${fmtTonBR(r.volume_entr, 2)} ton` : "-"}
                        <br />
                        <b>Saldo:</b> {r.saldo_rest !== null ? `${fmtTonBR(r.saldo_rest, 2)} ton` : "-"}
                      </div>
                    ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Tipo (padrão: SAÍDA)</label>
              <select style={styles.select} value={tipo} onChange={(e) => setTipo(e.target.value as TicketTipo)}>
                <option value="SAIDA">SAÍDA</option>
                <option value="ENTRADA">ENTRADA</option>
              </select>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Foto do ticket *</label>

              <input
                style={styles.input}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setOcrRaw(null);
                  setOcrNote(null);
                  setLastPayload(null);
                  setLastShareFile(null);
                  setLastResumo(null);
                  setLastAcum(null);
                  setLastEntradaPlanRows(null);
                  setLastEntradaAlloc(null);
                  setLastSavedIds(null);
                }}
              />

              <div style={styles.hint}>
                No celular isso abre a câmera. Depois clique em <b>Ler via OCR</b>.
              </div>
              {ocrNote ? (
                <div style={styles.hint}>
                  <b>{ocrNote}</b>
                </div>
              ) : null}
            </div>

            <div style={{ gridColumn: "span 12" }}>
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview do ticket"
                  style={{
                    width: "100%",
                    maxHeight: 420,
                    objectFit: "contain",
                    borderRadius: 16,
                    border: "1px solid #e5e7eb",
                    background: "#fff",
                  }}
                />
              ) : null}
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button type="button" style={styles.btnGhost} onClick={handleOcr} disabled={ocrLoading}>
                {ocrLoading ? "Lendo..." : "Ler via OCR"}
              </button>

              <button type="button" style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>

            {lastPayload ? (
              <div style={{ gridColumn: "span 12" }}>
                <button type="button" style={styles.btnShare} onClick={handleShareWhatsApp}>
                  Compartilhar no WhatsApp
                </button>
                <div style={styles.hint}>
                  No celular, abre o compartilhamento com a <b>foto</b> + texto (quando suportado). Se não suportar, abre WhatsApp com <b>texto</b>.
                </div>
              </div>
            ) : null}

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Veículo *</label>
              <input style={styles.input} value={veiculo} onChange={(e) => setVeiculo(e.target.value)} placeholder="Ex.: KBK-5C37" />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data *</label>
              <input
                style={styles.input}
                inputMode="numeric"
                value={dataBr}
                onChange={(e) => setDataBr(maskDateBRInput(e.target.value))}
                placeholder="15/01/26"
              />
              <div style={styles.hint}>{parsed.dataOk ? `OK → ${formatDateBR(parseDateBR(dataBr)!)}` : "Digite só números (150126)"}</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Horário *</label>
              <input style={styles.input} inputMode="numeric" value={hora} onChange={(e) => setHora(maskTimeInput(e.target.value))} placeholder="08:46:45" />
              <div style={styles.hint}>{parsed.horaOk ? "OK" : "Digite só números (084645)"}</div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Origem *</label>
              <input style={styles.input} value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: FETZ MINERADORA" />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra / Destino *</label>
              <input style={styles.input} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex.: PMRV TAPA BURACO" />
              {tipo === "ENTRADA" ? <div style={styles.hint}>Para ENTRADA da FETZ / PÁTIO ({PATIO_FETZ_OBRA}), o app salva como: <b>GPA ENGENHARIA</b>.</div> : null}
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Material *</label>
              <input style={styles.input} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: BRITA ZERO" />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Ordem de Compra (OC)</label>
              <input
                style={styles.input}
                value={oc}
                onChange={(e) => setOc(e.target.value)}
                placeholder="Ex.: 32026 (deixe vazio pra prefeitura/ordem ilimitada)"
              />
              <div style={styles.hint}>Se a obra for “infinita” (prefeitura), pode deixar vazio (OC = NULL).</div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Peso (t) *</label>
              <input style={styles.input} inputMode="numeric" value={peso} onChange={(e) => setPeso(maskPesoTon3(e.target.value))} placeholder="14.210" />
              <div style={styles.hint}>{parsed.pesoOk ? `OK → ${parsed.pesoNum} t` : "Digite só números (14210 → 14.210)"}</div>
            </div>

            {ocrRaw ? (
              <div style={{ gridColumn: "span 12" }}>
                <div style={{ ...styles.hint, marginTop: 0, marginBottom: 6 }}>OCR bruto (debug)</div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    borderRadius: 16,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    padding: 14,
                    fontSize: 12,
                    color: "#0f172a",
                    maxHeight: 220,
                    overflow: "auto",
                  }}
                >
                  {ocrRaw}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

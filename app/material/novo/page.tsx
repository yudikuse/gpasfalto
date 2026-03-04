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

type EntradaControle = {
  origem: string | null;
  obra: string | null;
  material: string | null;
  pedido_total_t: number | null;
  entrada_total_t: number | null;
  saldo_rest_t: number | null;
  plan_id: number | null;
  inicio_em: string | null;
};

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

async function makeOcrDataUrlFromImage(file: File): Promise<{ dataUrl: string; note: string | null }> {
  const MAX_BYTES = 4_500_000;

  try {
    const dataUrl = await fileToDataURL(file);
    const b64 = String(dataUrl.split(",")[1] || "");
    const approxBytes = Math.ceil((b64.length * 3) / 4);

    if (approxBytes <= MAX_BYTES) {
      return { dataUrl, note: null };
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Falha ao abrir imagem para otimização."));
      i.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { dataUrl, note: null };

    let scale = Math.sqrt(MAX_BYTES / approxBytes);
    scale = Math.max(0.2, Math.min(1, scale));

    canvas.width = Math.max(320, Math.floor(img.width * scale));
    canvas.height = Math.max(320, Math.floor(img.height * scale));

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let quality = 0.86;
    let out = canvas.toDataURL("image/jpeg", quality);

    for (let i = 0; i < 8; i++) {
      const b64o = out.split(",")[1] || "";
      const bytes = Math.ceil((b64o.length * 3) / 4);
      if (bytes <= MAX_BYTES) break;
      quality = Math.max(0.5, quality - 0.06);
      out = canvas.toDataURL("image/jpeg", quality);
    }

    return {
      dataUrl: out,
      note: "Foto otimizada automaticamente (para caber no limite do OCR).",
    };
  } catch {
    const dataUrl = await fileToDataURL(file);
    return { dataUrl, note: null };
  }
}

function normalizeVehicle(v: string | null) {
  const s = (v || "").trim().toUpperCase();
  if (!s) return "";
  const compact = s.replace(/\s+/g, "");
  return compact;
}

function normalizeText(v: string | null) {
  let s = (v || "").trim();
  if (!s) return "";
  s = s.replace(/\s+/g, " ");
  s = s.replace(/\s*-\s*([A-Za-z]{2})$/, (_m, uf) => ` - ${String(uf).toUpperCase()}`);
  return s;
}

function normalizeObraName(v: string) {
  const s = normalizeText(v);
  if (!s) return "";
  const u = s.toUpperCase();

  if (u === "GPA ENGENHARIA") return "GPA ENGENHARIA";

  // mantém o texto (a regra de "pátio" vira GPA mais abaixo)
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
  if (/^[A-Z]{3}-?\d[A-Z]\d{2}$/.test(compact)) return true;
  if (/^[A-Z]{3}-\d{4}$/.test(compact)) return true;
  if (/^[A-Z]{2}\d-?\d[A-Z0-9]\d{2}$/.test(compact)) return true;
  return false;
}

function isHeaderLine(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return true;
  if (u === "C") return true;
  if (u === "D") return true;

  if (
    /(GPA\s+ENGENHARIA\s+E\s+CONSTRU|TICKET\s+DE\s+PES|TICKET\s+DE\s+PESA\s*GEM|PESAGEM|PESAGEM\s+FINAL|PESAGEM\s+INICIAL|PESAGEM\s+FINAL\s+OK|PESA\s*GEM|PESA\s*GEM\s+FINAL\s+OK|PESA\s*GEM\s+INICIAL|VEIC\/CAVALO|MOTORISTA|ASSINATURA|RECEBIMENTO|INSPE|OBS\.?|UA-\d+|N°|TICKET\s+N|P\.\s*GERAL|P\.\s*OBRA)/i.test(
      u
    )
  )
    return true;

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(u)) return true;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(u)) return true;
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
  return /PATIO|PÁTIO/i.test(u) || /USINA\s*\(FETZ\+FRETE\)/i.test(u) || /FETZ\+FRETE/i.test(u);
}

function normalizeMaterialForMsg(s: string) {
  const u = (s || "").trim().toUpperCase();
  if (!u) return "";
  if (/P[ÓO]\s*DE\s*BRITA/.test(u)) return "PO BRITA";
  if (/P[ÓO]\s*BRITA/.test(u)) return "PO BRITA";
  if (/PO\s*BRITA/.test(u)) return "PO BRITA";
  if (/BRITA\s*0|BRITA\s*ZERO/.test(u)) return "BRITA ZERO";
  if (/BRITA\s*01|BRITA\s*1|BRITA\s*UM/.test(u)) return "BRITA 01";
  return (s || "").trim();
}

function fixEntradaFromRaw(raw: string): { origem?: string; destino?: string; material?: string; peso?: string } | null {
  const lines = String(raw || "")
    .split(/\r?\n/g)
    .map((x) => (x || "").trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const markerInline: Record<string, string> = {};
  for (const ln of lines) {
    const m = ln.match(/^([134])\s+(.+)$/);
    if (m) {
      const k = m[1];
      const v = (m[2] || "").trim();
      if (v && !isHeaderLine(v)) markerInline[k] = v;
    }
  }

  const findExactMarker = (m: string) => lines.findIndex((x) => (x || "").trim() === m);

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

  if (!destino) {
    const cand = lines.find((x) => /GPA\s+ENGENHARIA/i.test(x) && !isHeaderLine(x));
    if (cand) destino = cand.trim();
  }

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

    const tol = 0.01;
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

/**
 * ✅ NOVA REGRA (do Marcelo):
 * Se for pátio (qualquer variação), no app fica SEMPRE "GPA ENGENHARIA"
 * Isso vale para ENTRADA (e não mexe em SAÍDA).
 */
function resolveEntradaObra(origemVal: string, destinoVal: string) {
  const d = normalizeObraName(destinoVal);
  if (isPatioLike(d)) return "GPA ENGENHARIA";
  if (isFetzOrigem(origemVal || "")) return "GPA ENGENHARIA";
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

async function loadEntradaControle(origemVal: string, obraVal: string, matVal: string): Promise<EntradaControle | null> {
  try {
    const o = (origemVal || "").trim();
    const ob = (obraVal || "").trim();
    const mats = materialVariantsForLookup(matVal);

    if (!o || !mats.length) return null;

    const origemLike = isFetzOrigem(o) ? "%FETZ%" : `%${o}%`;

    for (const m of mats) {
      if (ob) {
        const r1 = await supabase
          .from("material_entrada_controle_v")
          .select("origem,obra,material,pedido_total_t,entrada_total_t,saldo_rest_t,plan_id,inicio_em")
          .ilike("origem", origemLike)
          .ilike("obra", `%${ob}%`)
          .ilike("material", `%${m}%`)
          .limit(1);

        if (!r1.error) {
          const data: any = Array.isArray(r1.data) ? r1.data[0] : r1.data;
          if (data) return data as any;
        }
      }

      const r2 = await supabase
        .from("material_entrada_controle_v")
        .select("origem,obra,material,pedido_total_t,entrada_total_t,saldo_rest_t,plan_id,inicio_em")
        .ilike("origem", origemLike)
        .ilike("material", `%${m}%`)
        .limit(1);

      if (!r2.error) {
        const data: any = Array.isArray(r2.data) ? r2.data[0] : r2.data;
        if (data) return data as any;
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function loadResumo(obraVal: string, ocVal: string | null, matVal: string): Promise<OcResumo | null> {
  try {
    const obraTrim = normalizeObraName(obraVal);
    const matTrim = normalizeMaterialForMsg(matVal);

    if (!obraTrim || !matTrim) return null;

    let q = supabase
      .from("material_oc_plan_resumo_v")
      .select("plan_id,obra,oc,material,ilimitado,total_t,entrada_t,saida_t,saldo_t")
      .ilike("obra", obraTrim)
      .ilike("material", matTrim)
      .limit(1);

    if (ocVal) q = q.eq("oc", ocVal);
    else q = q.is("oc", null);

    const { data, error } = await q;
    if (error) return null;

    const row = Array.isArray(data) ? data[0] : data;
    return (row as any) ?? null;
  } catch {
    return null;
  }
}

async function loadAcumulados(tipoVal: TicketTipo, obraVal: string, ocVal: string | null, matVal: string, dateISO: string): Promise<Acumulados | null> {
  try {
    const obraTrim = normalizeObraName(obraVal);
    const matTrim = normalizeMaterialForMsg(matVal);

    if (!obraTrim || !matTrim || !dateISO) return null;

    const { data, error } = await supabase.rpc("material_ticket_acumulados", {
      p_tipo: tipoVal,
      p_obra: obraTrim,
      p_oc: ocVal,
      p_material: matTrim,
      p_data: dateISO,
    });

    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row as any) ?? null;
  } catch {
    return null;
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
  id: number;
  resumo: OcResumo | null;
  acum: Acumulados | null;
  entradaCtl: EntradaControle | null;
}) {
  const { tipo, veiculo, origem, obra, material, oc, dataISO, horarioISO, pesoNum, id, resumo, acum, entradaCtl } = p;

  const dt = dataISO.split("-").reverse().join("/");
  const hr = horarioISO;

  const linhas: string[] = [];
  linhas.push(`*TICKET MATERIAL* (#${id})`);
  linhas.push(`Tipo: *${tipo}*`);
  linhas.push(`Veículo: ${veiculo}`);
  linhas.push(`Origem: ${origem}`);
  linhas.push(`Obra/Destino: ${obra}`);
  linhas.push(`Material: ${normalizeMaterialForMsg(material)}`);
  if (oc) linhas.push(`OC: ${oc}`);
  linhas.push(`Data/Hora: ${dt} ${hr}`);
  linhas.push(`Peso: *${pesoNum.toFixed(3)} t*`);

  if (tipo === "SAIDA") {
    if (resumo) {
      if (resumo.ilimitado) {
        linhas.push(`Plano: *ILIMITADO*`);
      } else {
        linhas.push(`Plano: Total ${fmtT(resumo.total_t)} t • Saldo ${fmtT(resumo.saldo_t)} t`);
      }
    } else {
      linhas.push(`Plano: ⚠️ não encontrado`);
    }

    if (acum) {
      linhas.push(`Hoje: ${fmtQtd(acum.dia_qtd)} tickets • ${fmtT(acum.dia_total_t)} t`);
      linhas.push(`Semana: ${fmtQtd(acum.semana_qtd)} tickets • ${fmtT(acum.semana_total_t)} t`);
      linhas.push(`Mês: ${fmtQtd(acum.mes_qtd)} tickets • ${fmtT(acum.mes_total_t)} t`);
    }
  } else {
    if (entradaCtl) {
      linhas.push(`Pedido: ${entradaCtl.pedido_total_t ? `${fmtTonBR(entradaCtl.pedido_total_t, 0)} ton` : "-"}`);
      linhas.push(`Entrada total: ${entradaCtl.entrada_total_t ? `${fmtTonBR(entradaCtl.entrada_total_t, 2)} ton` : "-"}`);
      linhas.push(`Saldo: ${entradaCtl.saldo_rest_t ? `${fmtTonBR(entradaCtl.saldo_rest_t, 2)} ton` : "-"}`);
    }
  }

  return linhas.join("\n");
}

export default function MaterialTicketNovoPage() {
  const [tipo, setTipo] = useState<TicketTipo>("SAIDA");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [veiculo, setVeiculo] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
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
  const [lastEntradaCtl, setLastEntradaCtl] = useState<EntradaControle | null>(null);

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

  function validateBasic() {
    setError(null);

    if (!file) return setError("Envie a foto do ticket."), false;
    if (!veiculo.trim()) return setError("Informe o veículo."), false;
    if (!origem.trim()) return setError("Informe a origem."), false;
    if (!destino.trim()) return setError("Informe a obra/destino."), false;
    if (!material.trim()) return setError("Informe o material."), false;

    if (!parsed.dataOk) return setError("Data inválida."), false;
    if (!parsed.horaOk) return setError("Horário inválido."), false;

    if (!parsed.pesoOk) return setError("Peso inválido."), false;
    if ((parsed.pesoNum ?? 0) <= 0) return setError("Peso deve ser maior que 0."), false;

    return true;
  }

  async function handleShareWhatsApp() {
    if (!lastPayload) return;

    const msg = buildWhatsappMessage({
      ...lastPayload,
      resumo: lastResumo,
      acum: lastAcum,
      entradaCtl: lastEntradaCtl,
    });

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;

    try {
      if (navigator.share && lastShareFile) {
        await navigator.share({
          text: msg,
          files: [lastShareFile],
        });
        return;
      }
    } catch {}

    window.open(url, "_blank");
  }

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

      if (tipo === "ENTRADA" && js?.raw) {
        const fixed = fixEntradaFromRaw(String(js.raw));
        if (fixed) {
          if (fixed.origem && !isHeaderLine(fixed.origem)) oVal = fixed.origem;
          if (fixed.destino && !isBadDestino(fixed.destino)) dVal = fixed.destino;
          if (fixed.material && isLikelyMaterial(fixed.material)) mVal = fixed.material;

          const pNum = parsePesoMasked(pVal);
          if (fixed.peso && (pNum === null || pNum <= 0)) pVal = fixed.peso;
        }

        if (mVal) mVal = normalizeMaterialForMsg(mVal);

        // ✅ NOVA REGRA: se for pátio ou origem FETZ, destino vira GPA ENGENHARIA
        dVal = resolveEntradaObra(oVal, dVal);
      }

      if (vVal) setVeiculo(vVal);
      if (oVal) setOrigem(oVal);

      if (dVal && !isBadDestino(dVal)) setDestino(dVal);

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
    setLastEntradaCtl(null);

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

      // ✅ ENTRADA: aplica regra do pátio -> GPA ENGENHARIA
      const obraVal = tipo === "ENTRADA" ? resolveEntradaObra(origem.trim(), destino) : normalizeObraName(destino);

      const ins = await supabase
        .from("material_tickets")
        .insert({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          destino: obraVal,
          obra: obraVal,
          material: normalizeMaterialForMsg(material.trim()),
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

      const acum = await loadAcumulados(tipo, obraVal, ocVal, normalizeMaterialForMsg(material.trim()), dateISO);
      setLastAcum(acum);

      if (tipo === "ENTRADA") {
        const ctl = await loadEntradaControle(origem.trim(), obraVal, normalizeMaterialForMsg(material.trim()));
        setLastEntradaCtl(ctl);
        setSavedMsg("Salvo com sucesso!");
      } else {
        let resumo = await loadResumo(obraVal, ocVal, material.trim());
        let createdPlan = false;

        if (!resumo) {
          createdPlan = await ensurePlanIlimitado(obraVal, ocVal, material.trim());
          if (createdPlan) resumo = await loadResumo(obraVal, ocVal, material.trim());
        }

        setLastResumo(resumo);

        if (createdPlan) setSavedMsg("Salvo com sucesso! Plano cadastrado como ILIMITADO (ajuste depois se necessário).");
        else if (!resumo) setSavedMsg("Salvo com sucesso! ⚠️ Plano não encontrado (confira Obra/Material e cadastre no plano).");
        else setSavedMsg("Salvo com sucesso!");
      }

      if (newId) {
        setLastPayload({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          obra: obraVal,
          material: normalizeMaterialForMsg(material.trim()),
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

  const styles: Record<string, CSSProperties> = {
    container: { maxWidth: 720, margin: "0 auto", padding: 18, paddingBottom: 80 },
    title: { fontSize: 18, fontWeight: 800, marginBottom: 12 },
    card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 14, boxShadow: "0 6px 18px rgba(0,0,0,0.05)" },
    label: { display: "block", fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: "#374151", textTransform: "uppercase", marginBottom: 6 },
    input: { width: "100%", height: 46, padding: "0 14px", borderRadius: 14, border: "1px solid #e5e7eb", outline: "none", fontSize: 16, background: "#fff" },
    select: { width: "100%", height: 46, padding: "0 12px", borderRadius: 14, border: "1px solid #e5e7eb", outline: "none", fontSize: 16, background: "#fff" },
    hint: { fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.35 },
    btnGhost: { height: 46, borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 800, cursor: "pointer" },
    btnPrimary: { height: 46, borderRadius: 14, border: "none", background: "linear-gradient(90deg, #f97316, #ef4444)", color: "#fff", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 26px rgba(239,68,68,0.25)" },
    btnShare: { height: 46, width: "100%", borderRadius: 14, border: "none", background: "#16a34a", color: "#fff", fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 26px rgba(22,163,74,0.25)" },
    alert: { borderRadius: 14, padding: 12, fontSize: 13, lineHeight: 1.35, border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b" },
    ok: { borderRadius: 14, padding: 12, fontSize: 13, lineHeight: 1.35, border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#14532d" },
    debugBox: { borderRadius: 14, padding: 12, fontSize: 12, lineHeight: 1.35, border: "1px solid #e5e7eb", background: "#f9fafb", color: "#111827", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  };

  const unidadeQtd = tipo === "SAIDA" ? "saídas" : "entradas";

  return (
    <div style={styles.container}>
      <div style={styles.title}>Ticket de Material</div>

      <div style={styles.card}>
        {error ? <div style={{ ...styles.alert, marginBottom: 10 }}>{error}</div> : null}
        {savedMsg ? <div style={{ ...styles.ok, marginBottom: 10 }}>{savedMsg}</div> : null}

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
                setLastEntradaCtl(null);
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
            <input style={styles.input} inputMode="numeric" value={dataBr} onChange={(e) => setDataBr(maskDateBRInput(e.target.value))} placeholder="15/01/26" />
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
            <input style={styles.input} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex.: GPA ENGENHARIA" />
            <div style={styles.hint}>
              Regra: se for <b>PÁTIO</b> (qualquer variação), o app salva como <b>GPA ENGENHARIA</b>.
            </div>
          </div>

          <div style={{ gridColumn: "span 12" }}>
            <label style={styles.label}>Material *</label>
            <input style={styles.input} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: PO BRITA" />
          </div>

          <div style={{ gridColumn: "span 12" }}>
            <label style={styles.label}>Ordem de Compra (OC)</label>
            <input style={styles.input} value={oc} onChange={(e) => setOc(e.target.value)} placeholder="Ex.: 32026 (deixe vazio para prefeitura/obra infinita)" />
            <div style={styles.hint}>Se a obra for "infinita" (prefeitura), pode deixar vazio (OC = NULL).</div>
          </div>

          <div style={{ gridColumn: "span 12" }}>
            <label style={styles.label}>Peso (t) *</label>
            <input
              style={styles.input}
              inputMode="decimal"
              value={peso}
              onChange={(e) => setPeso(e.target.value.replace(/[^\d.,]/g, ""))}
              placeholder="0.000"
            />
            <div style={styles.hint}>{parsed.pesoOk ? `OK → ${fmtT(parsed.pesoNum)} t` : "Ex.: 29.630"}</div>
          </div>

          {ocrRaw ? (
            <div style={{ gridColumn: "span 12" }}>
              <div style={{ ...styles.hint, marginBottom: 6 }}>
                <b>OCR bruto (debug)</b>
              </div>
              <div style={styles.debugBox}>{ocrRaw}</div>
            </div>
          ) : null}
        </div>

        {lastAcum ? (
          <div style={{ marginTop: 12, fontSize: 12, color: "#374151", lineHeight: 1.35 }}>
            <b>Acumulado:</b> {fmtQtd(lastAcum.dia_qtd)} {unidadeQtd} • <b>Total no dia:</b> {fmtT(lastAcum.dia_total_t)} t
            <br />
            <b>Semana (Seg-Dom):</b> {fmtQtd(lastAcum.semana_qtd)} {unidadeQtd} • <b>Total:</b> {fmtT(lastAcum.semana_total_t)} t
            <br />
            <b>Mês:</b> {fmtQtd(lastAcum.mes_qtd)} {unidadeQtd} • <b>Total:</b> {fmtT(lastAcum.mes_total_t)} t
          </div>
        ) : null}

        {tipo === "SAIDA" && lastResumo ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#14532d" }}>
            <b>Controle:</b> {lastResumo.ilimitado ? `ILIMITADO` : `Total: ${fmtT(lastResumo.total_t)} t • Saldo: ${fmtT(lastResumo.saldo_t)} t`}
          </div>
        ) : null}

        {tipo === "ENTRADA" && lastEntradaCtl ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#14532d", lineHeight: 1.35 }}>
            <b>Obra:</b> {lastEntradaCtl.obra ?? "-"}
            <br />
            <b>Material:</b> {normalizeMaterialForMsg(lastEntradaCtl.material ?? "-")}
            <br />
            <b>Pedido:</b> {lastEntradaCtl.pedido_total_t ? `${fmtTonBR(lastEntradaCtl.pedido_total_t, 0)} ton` : "-"}
            <br />
            <b>Entrada total:</b> {lastEntradaCtl.entrada_total_t ? `${fmtTonBR(lastEntradaCtl.entrada_total_t, 2)} ton` : "-"}
            <br />
            <b>Saldo:</b> {lastEntradaCtl.saldo_rest_t ? `${fmtTonBR(lastEntradaCtl.saldo_rest_t, 2)} ton` : "-"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

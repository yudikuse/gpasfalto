// FILE: app/material/novo/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type TicketTipo = "ENTRADA" | "SAIDA";

function extFromFile(file: File) {
  const t = (file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("pdf")) return "pdf";
  return "jpg";
}

/** Máscara: digita 150126 -> 15/01/26 | digita 15012026 -> 15/01/2026 */
function maskDateBRInput(raw: string) {
  const d = (raw || "").replace(/\D+/g, "").slice(0, 8); // ddmmyyyy
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  if (d.length <= 6) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`; // dd/mm/yy
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4, 8)}`; // dd/mm/yyyy
}

/** Máscara: digita 0753 -> 07:53 | digita 075307 -> 07:53:07 */
function maskTimeInput(raw: string) {
  const d = (raw || "").replace(/\D+/g, "").slice(0, 6); // hhmmss
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}:${d.slice(2)}`; // hh:mm
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4, 6)}`; // hh:mm:ss
}

/**
 * Máscara do peso em toneladas com 3 casas (padrão "2.720").
 * - digite "2720" -> "2.720"
 * - digite "28"   -> "0.028"
 */
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
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd)
    return null;

  return d;
}

/** Aceita hh:mm ou hh:mm:ss */
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

function normalizeVehicle(v: string | null) {
  const s = (v || "").trim();
  if (!s) return "";
  return s.toUpperCase();
}

function normalizeText(v: string | null) {
  return (v || "").trim();
}

function normalizeDateFromOcrToMasked(ddmmaaOrDdmmYyyy: string | null) {
  // o endpoint retorna data_br em dd/mm/yy
  const v = (ddmmaaOrDdmmYyyy || "").trim();
  if (!v) return "";
  return v;
}

function normalizeTimeFromOcrToMasked(v: string | null) {
  const s = (v || "").trim();
  if (!s) return "";
  // aceita "07:53" ou "07:53:07"
  return s;
}

function normalizePesoFromOcrToMasked(v: any) {
  if (v === null || v === undefined) return "";
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return Number(n).toFixed(3);
}

export default function MaterialTicketNovoPage() {
  const [tipo, setTipo] = useState<TicketTipo>("ENTRADA");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [veiculo, setVeiculo] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [material, setMaterial] = useState("");
  const [dataBr, setDataBr] = useState("");
  const [hora, setHora] = useState("");
  const [peso, setPeso] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [ocrRaw, setOcrRaw] = useState<string | null>(null);

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
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
          d.getDate()
        ).padStart(2, "0")}`
      : null;

    const timeISO = t
      ? `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(
          2,
          "0"
        )}:${String(t.ss).padStart(2, "0")}`
      : null;

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

    if (!file) return setError("Envie a foto (ou PDF) do ticket."), false;
    if (file.type?.includes("pdf"))
      return setError("OCR ainda não suporta PDF. Envie imagem (jpg/png/webp)."), false;

    if (!veiculo.trim()) return setError("Preencha o veículo."), false;
    if (!origem.trim()) return setError("Preencha a origem."), false;
    if (!destino.trim()) return setError("Preencha o destino."), false;
    if (!material.trim()) return setError("Preencha o material."), false;
    if (!parsed.dataOk) return setError("Data inválida. Use dd/mm/aa ou dd/mm/aaaa."), false;
    if (!parsed.horaOk) return setError("Horário inválido. Use hh:mm ou hh:mm:ss."), false;
    if (!parsed.pesoOk) return setError("Peso inválido. Digite só números (ex.: 2720 → 2.720)."), false;

    return true;
  }

  async function handleOcr() {
    setError(null);
    setSavedMsg(null);
    setSavedId(null);

    if (!file) {
      setError("Envie a foto do ticket para ler via OCR.");
      return;
    }
    if (file.type?.includes("pdf")) {
      setError("OCR ainda não suporta PDF. Envie imagem (jpg/png/webp).");
      return;
    }

    setOcrLoading(true);
    try {
      const dataUrl = await fileToDataURL(file);
      const res = await fetch("/api/vision/material-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });

      const js = await res.json().catch(() => null);
      if (!res.ok || !js?.ok) {
        throw new Error(js?.error || "OCR falhou.");
      }

      setOcrRaw(js?.raw || null);

      const f = js?.fields || {};

      const v = normalizeVehicle(f.veiculo || null);
      const o = normalizeText(f.origem || null);
      const d = normalizeText(f.destino || null);
      const m = normalizeText(f.material || null);
      const dt = normalizeDateFromOcrToMasked(f.data_br || null);
      const hr = normalizeTimeFromOcrToMasked(f.horario || null);
      const p = normalizePesoFromOcrToMasked(f.peso_mask ?? f.peso_t ?? null);

      // preencher apenas se vier algo; senão mantém o que o usuário digitou
      if (v) setVeiculo(v);
      if (o) setOrigem(o);
      if (d) setDestino(d);
      if (m) setMaterial(m);
      if (dt) setDataBr(dt);
      if (hr) setHora(hr);
      if (p) setPeso(p);

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

      const ins = await supabase
        .from("material_tickets")
        .insert({
          tipo,
          veiculo: veiculo.trim(),
          origem: origem.trim(),
          destino: destino.trim(),
          material: material.trim(),
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

      setSavedId(ins.data?.id ?? null);
      setSavedMsg("Salvo com sucesso!");

      setFile(null);
      setVeiculo("");
      setOrigem("");
      setDestino("");
      setMaterial("");
      setDataBr("");
      setHora("");
      setPeso("");
      setOcrRaw(null);
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
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
      fontSize: 14,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    select: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 14,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    btnPrimary: {
      borderRadius: 14,
      border: "1px solid #fb7185",
      background: saving
        ? "linear-gradient(180deg, #94a3b8, #64748b)"
        : "linear-gradient(180deg, #ff4b2b, #fb7185)",
      color: "#fff",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: saving ? "not-allowed" : "pointer",
      fontSize: 14,
      boxShadow: saving ? "none" : "0 14px 26px rgba(255, 75, 43, 0.20)",
      opacity: saving ? 0.8 : 1,
    },
    btnGhost: {
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: ocrLoading ? "#e2e8f0" : "#ffffff",
      color: "#0f172a",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: ocrLoading ? "not-allowed" : "pointer",
      fontSize: 14,
    },
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 },
  };

  return (
    <div className="page-root">
      <div className="page-container">
        <header className="page-header" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{ width: 120, height: 120, objectFit: "contain", border: "none", background: "transparent" }}
          />
          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main">Materiais • Ticket</div>
            <div className="brand-text-sub">Upload + OCR + salvar no Supabase</div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo ticket</div>
              <div className="section-subtitle">Envie o ticket, clique em OCR, ajuste e salve.</div>
            </div>
          </div>

          {error ? (
            <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>
              {error}
            </div>
          ) : null}

          {savedMsg ? (
            <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>
              {savedMsg} {savedId ? <>ID: <b>{savedId}</b></> : null}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Tipo</label>
              <select style={styles.select} value={tipo} onChange={(e) => setTipo(e.target.value as TicketTipo)}>
                <option value="ENTRADA">ENTRADA</option>
                <option value="SAIDA">SAÍDA</option>
              </select>
            </div>

            <div style={{ gridColumn: "span 8" }}>
              <label style={styles.label}>Arquivo do ticket *</label>
              <input
                style={styles.input}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setOcrRaw(null);
                }}
              />
              <div style={styles.hint}>OCR: somente imagens (jpg/png/webp). PDF: só upload por enquanto.</div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              {previewUrl ? (
                file?.type?.includes("pdf") ? (
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 12, background: "#f9fafb", fontSize: 14, color: "#334155" }}>
                    PDF selecionado: <b>{file.name}</b> (OCR para PDF vem depois)
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Preview do ticket"
                    style={{ width: "100%", maxHeight: 420, objectFit: "contain", borderRadius: 16, border: "1px solid #e5e7eb", background: "#fff" }}
                  />
                )
              ) : null}
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={styles.btnGhost} onClick={handleOcr} disabled={ocrLoading}>
                {ocrLoading ? "Lendo OCR..." : "Ler via OCR"}
              </button>

              <button type="button" style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? "Salvando..." : "Salvar no Supabase"}
              </button>
            </div>

            <div style={{ gridColumn: "span 3" }}>
              <label style={styles.label}>Veículo *</label>
              <input style={styles.input} value={veiculo} onChange={(e) => setVeiculo(e.target.value)} placeholder="Ex.: CE-02" />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Data *</label>
              <input style={styles.input} inputMode="numeric" value={dataBr} onChange={(e) => setDataBr(maskDateBRInput(e.target.value))} placeholder="15/01/26" />
              <div style={styles.hint}>{parsed.dataOk ? `OK → ${formatDateBR(parseDateBR(dataBr)!)}` : "Digite só números (ex.: 150126)"}</div>
            </div>

            <div style={{ gridColumn: "span 5" }}>
              <label style={styles.label}>Horário *</label>
              <input style={styles.input} inputMode="numeric" value={hora} onChange={(e) => setHora(maskTimeInput(e.target.value))} placeholder="07:53:07" />
              <div style={styles.hint}>{parsed.horaOk ? "OK" : "Digite só números (ex.: 0753 ou 075307)"}</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Origem *</label>
              <input style={styles.input} value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: GPA Engenharia" />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Destino *</label>
              <input style={styles.input} value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex.: Cargill" />
            </div>

            <div style={{ gridColumn: "span 8" }}>
              <label style={styles.label}>Material *</label>
              <input style={styles.input} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Ex.: RR-1C Diluído" />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Peso (t) *</label>
              <input style={styles.input} inputMode="numeric" value={peso} onChange={(e) => setPeso(maskPesoTon3(e.target.value))} placeholder="2.720" />
              <div style={styles.hint}>{parsed.pesoOk ? `OK → ${parsed.pesoNum} t` : "Digite só números (ex.: 2720 → 2.720)"}</div>
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

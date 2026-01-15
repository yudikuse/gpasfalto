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
 * - cola "2,720" ou "2.720" -> vira "2.720"
 */
function maskPesoTon3(raw: string) {
  const digits = (raw || "").replace(/\D+/g, "").slice(0, 15);
  if (!digits) return "";
  const n = Number(digits) / 1000;
  if (!Number.isFinite(n)) return "";
  return n.toFixed(3); // ponto decimal (igual ao ticket)
}

function parseDateBR(raw: string): Date | null {
  const v = (raw || "").trim();
  if (!v) return null;

  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  let yy = Number(m[3]);

  if (m[3].length === 2) {
    yy = yy <= 69 ? 2000 + yy : 1900 + yy;
  }

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

export default function MaterialTicketNovoPage() {
  const [tipo, setTipo] = useState<TicketTipo>("ENTRADA");

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [veiculo, setVeiculo] = useState("");
  const [origem, setOrigem] = useState("");
  const [destino, setDestino] = useState("");
  const [material, setMaterial] = useState("");
  const [dataBr, setDataBr] = useState(""); // dd/mm/aa ou dd/mm/aaaa
  const [hora, setHora] = useState(""); // hh:mm ou hh:mm:ss
  const [peso, setPeso] = useState(""); // "2.720"

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

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

    if (!file) {
      setError("Envie a foto (ou PDF) do ticket.");
      return false;
    }
    if (!veiculo.trim()) {
      setError("Preencha o veículo.");
      return false;
    }
    if (!origem.trim()) {
      setError("Preencha a origem.");
      return false;
    }
    if (!destino.trim()) {
      setError("Preencha o destino.");
      return false;
    }
    if (!material.trim()) {
      setError("Preencha o material.");
      return false;
    }
    if (!parsed.dataOk) {
      setError("Data inválida. Use dd/mm/aa ou dd/mm/aaaa.");
      return false;
    }
    if (!parsed.horaOk) {
      setError("Horário inválido. Use hh:mm ou hh:mm:ss.");
      return false;
    }
    if (!parsed.pesoOk) {
      setError("Peso inválido. Digite só números (ex.: 2720 → 2.720).");
      return false;
    }

    return true;
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
      const baseName =
        safePathPart(file!.name.replace(/\.[^.]+$/, "")) || "ticket";
      const id = uuid();

      const storagePath = `material/${dateISO}/${veic}-${baseName}-${id}.${ext}`;

      // 1) upload do arquivo
      const up = await supabase.storage
        .from("tickets")
        .upload(storagePath, file!, {
          upsert: false,
          cacheControl: "3600",
          contentType: file!.type || "application/octet-stream",
        });

      if (up.error) throw new Error(`Storage upload falhou: ${up.error.message}`);

      // 2) insert na tabela
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

      // limpa campos
      setFile(null);
      setVeiculo("");
      setOrigem("");
      setDestino("");
      setMaterial("");
      setDataBr("");
      setHora("");
      setPeso("");
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
    btn: {
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
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 },
  };

  return (
    <div className="page-root">
      <div className="page-container">
        <header
          className="page-header"
          style={{ flexDirection: "column", alignItems: "center", gap: 8 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{
              width: 120,
              height: 120,
              objectFit: "contain",
              border: "none",
              background: "transparent",
            }}
          />

          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main">Materiais • Ticket</div>
            <div className="brand-text-sub">Upload + salvar no Supabase</div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo ticket</div>
              <div className="section-subtitle">
                Envie o ticket e preencha os campos. (Ex.: 15/01/26)
              </div>
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
              {savedMsg}{" "}
              {savedId ? (
                <>
                  ID: <b>{savedId}</b>
                </>
              ) : null}
            </div>
          ) : null}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gap: 14,
            }}
          >
            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Tipo</label>
              <select
                style={styles.select}
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TicketTipo)}
              >
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
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div style={styles.hint}>
                Bucket: <b>tickets</b> (privado com policy SELECT/INSERT).
              </div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              {previewUrl ? (
                file?.type?.includes("pdf") ? (
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 16,
                      padding: 12,
                      background: "#f9fafb",
                      fontSize: 14,
                      color: "#334155",
                    }}
                  >
                    PDF selecionado: <b>{file.name}</b>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
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
                )
              ) : null}
            </div>

            <div style={{ gridColumn: "span 3" }}>
              <label style={styles.label}>Veículo *</label>
              <input
                style={styles.input}
                value={veiculo}
                onChange={(e) => setVeiculo(e.target.value)}
                placeholder="Ex.: CE-02"
              />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Data *</label>
              <input
                style={styles.input}
                inputMode="numeric"
                value={dataBr}
                onChange={(e) => setDataBr(maskDateBRInput(e.target.value))}
                placeholder="15/01/26"
              />
              <div style={styles.hint}>
                {parsed.dataOk
                  ? `OK → ${formatDateBR(parseDateBR(dataBr)!)}` 
                  : "Digite só números (ex.: 150126)"}
              </div>
            </div>

            <div style={{ gridColumn: "span 5" }}>
              <label style={styles.label}>Horário *</label>
              <input
                style={styles.input}
                inputMode="numeric"
                value={hora}
                onChange={(e) => setHora(maskTimeInput(e.target.value))}
                placeholder="07:53:07"
              />
              <div style={styles.hint}>
                {parsed.horaOk
                  ? "OK"
                  : "Digite só números (ex.: 0753 ou 075307)"}
              </div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Origem *</label>
              <input
                style={styles.input}
                value={origem}
                onChange={(e) => setOrigem(e.target.value)}
                placeholder="Ex.: GPA Engenharia"
              />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Destino *</label>
              <input
                style={styles.input}
                value={destino}
                onChange={(e) => setDestino(e.target.value)}
                placeholder="Ex.: Cargill"
              />
            </div>

            <div style={{ gridColumn: "span 8" }}>
              <label style={styles.label}>Material *</label>
              <input
                style={styles.input}
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="Ex.: RR-1C Diluído"
              />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Peso (t) *</label>
              <input
                style={styles.input}
                inputMode="numeric"
                value={peso}
                onChange={(e) => setPeso(maskPesoTon3(e.target.value))}
                placeholder="2.720"
              />
              <div style={styles.hint}>
                {parsed.pesoOk
                  ? `OK → ${parsed.pesoNum} t`
                  : "Digite só números (ex.: 2720 → 2.720)"}
              </div>
            </div>

            <div
              style={{
                gridColumn: "span 12",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                style={styles.btn}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar no Supabase"}
              </button>
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Prévia do que vai ser salvo</div>
              <div className="section-subtitle">
                Tabela: material_tickets • Bucket: tickets
              </div>
            </div>
          </div>

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
            }}
          >
{JSON.stringify(
  {
    tipo,
    veiculo: veiculo || null,
    origem: origem || null,
    destino: destino || null,
    material: material || null,
    data: parsed.dataISO,
    horario: parsed.timeISO,
    peso_t: parsed.pesoOk ? parsed.pesoNum : null,
    arquivo: file ? { name: file.name, type: file.type || null, size: file.size } : null,
  },
  null,
  2
)}
          </pre>
        </div>
      </div>
    </div>
  );
}

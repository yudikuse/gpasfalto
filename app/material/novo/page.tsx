// FILE: app/material/novo/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type TicketTipo = "ENTRADA" | "SAIDA";

function extFromFile(file: File) {
  const t = (file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("pdf")) return "pdf";
  return "jpg";
}

/**
 * Peso: aceita "2.720" (ponto), "2,720" (vírgula) e casos com milhar.
 * Regras:
 * - Se tiver vírgula: assume vírgula decimal e remove pontos de milhar.
 * - Se só tiver ponto:
 *    - se tiver mais de um ponto: remove todos menos o último (último é decimal)
 *    - se tiver 1 ponto: trata como decimal.
 */
function parsePesoFlexible(raw: string): number | null {
  const s0 = (raw || "").trim();
  if (!s0) return null;

  // mantém só dígitos, ponto, vírgula
  const s = s0.replace(/[^\d.,-]/g, "");

  if (!s) return null;

  if (s.includes(",")) {
    // vírgula decimal (pt-BR)
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  }

  // só ponto (ou nenhum)
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount <= 1) {
    const n = Number.parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  // vários pontos: remove todos, menos o último
  const last = s.lastIndexOf(".");
  const head = s.slice(0, last).replace(/\./g, "");
  const tail = s.slice(last + 1);
  const normalized = `${head}.${tail}`;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseDateBR(raw: string): Date | null {
  const v = (raw || "").trim();
  if (!v) return null;

  // aceita dd/mm/yy ou dd/mm/yyyy
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  let yy = Number(m[3]);

  if (m[3].length === 2) {
    // 00-69 => 2000-2069, 70-99 => 1970-1999 (ajuste simples)
    yy = yy <= 69 ? 2000 + yy : 1900 + yy;
  }

  const d = new Date(yy, mm - 1, dd);
  // valida se não estourou (ex.: 32/01/2026)
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd)
    return null;

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

function formatDateBR(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
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
  const [hora, setHora] = useState(""); // hh:mm:ss
  const [peso, setPeso] = useState(""); // ex: 2.720

  const [error, setError] = useState<string | null>(null);

  // preview da imagem
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
    const p = parsePesoFlexible(peso);

    return {
      dataOk: Boolean(d),
      horaOk: Boolean(t),
      pesoOk: p !== null,
      dataISO: d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : null,
      timeISO: t ? `${String(t.hh).padStart(2, "0")}:${String(t.mm).padStart(2, "0")}:${String(t.ss).padStart(2, "0")}` : null,
      pesoNum: p,
    };
  }, [dataBr, hora, peso]);

  function validateBasic() {
    setError(null);

    if (!file) return setError("Envie a foto (ou PDF) do ticket.");
    if (!veiculo.trim()) return setError("Preencha o veículo.");
    if (!origem.trim()) return setError("Preencha a origem.");
    if (!destino.trim()) return setError("Preencha o destino.");
    if (!material.trim()) return setError("Preencha o material.");
    if (!parsed.dataOk) return setError("Data inválida. Use dd/mm/aa ou dd/mm/aaaa.");
    if (!parsed.horaOk) return setError("Horário inválido. Use hh:mm:ss.");
    if (!parsed.pesoOk) return setError("Peso inválido. Ex.: 2.720 ou 2,720.");

    return true;
  }

  function handleTestPreview() {
    const ok = validateBasic();
    if (ok !== true) return;

    // por enquanto só mostramos no console; no próximo passo vamos salvar no Supabase
    const payload = {
      tipo,
      veiculo: veiculo.trim(),
      origem: origem.trim(),
      destino: destino.trim(),
      material: material.trim(),
      data: parsed.dataISO,
      horario: parsed.timeISO,
      peso_t: parsed.pesoNum,
      arquivo_ext: file ? extFromFile(file) : null,
      arquivo_nome: file ? file.name : null,
    };

    console.log("[ticket-material payload]", payload);
    alert("OK! Payload montado. (Veja o console). Próximo passo: salvar no Supabase.");
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
      background: "linear-gradient(180deg, #ff4b2b, #fb7185)",
      color: "#fff",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: "pointer",
      fontSize: 14,
      boxShadow: "0 14px 26px rgba(255, 75, 43, 0.20)",
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
            <div className="brand-text-sub">
              Upload + campos (no próximo passo: salvar no Supabase)
            </div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo ticket</div>
              <div className="section-subtitle">
                Envie o ticket e preencha os campos. (Ex.: data correta 15/01/26)
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
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <div style={styles.hint}>PNG/JPG/WebP/PDF (por enquanto só preview; OCR vem depois).</div>
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
                    PDF selecionado: <b>{file.name}</b> (preview visual do PDF vamos fazer depois)
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
                value={dataBr}
                onChange={(e) => setDataBr(e.target.value)}
                placeholder="Ex.: 15/01/26"
              />
              <div style={styles.hint}>
                {parsed.dataOk ? `OK → ${formatDateBR(parseDateBR(dataBr)!)}` : "Use dd/mm/aa"}
              </div>
            </div>

            <div style={{ gridColumn: "span 5" }}>
              <label style={styles.label}>Horário *</label>
              <input
                style={styles.input}
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                placeholder="Ex.: 07:53:07"
              />
              <div style={styles.hint}>{parsed.horaOk ? "OK" : "Use hh:mm:ss"}</div>
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
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="Ex.: 2.720"
              />
              <div style={styles.hint}>
                {parsed.pesoOk ? `OK → ${parsed.pesoNum} t` : "Aceita 2.720 ou 2,720"}
              </div>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" style={styles.btn} onClick={handleTestPreview}>
                Testar (montar payload)
              </button>
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Prévia do que vai ser salvo</div>
              <div className="section-subtitle">No próximo passo: Storage + tabela no Supabase.</div>
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

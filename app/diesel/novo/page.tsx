"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EquipOption = { value: string };

function onlyDigits(s: string) {
  return (s || "").replace(/\D+/g, "");
}

function normalizeDecimalBRInput(raw: string) {
  let v = (raw || "").replace(/[^\d,]/g, "");
  const parts = v.split(",");
  if (parts.length > 2) v = parts[0] + "," + parts.slice(1).join("");
  return v;
}

function parseDecimalBR(raw: string): number | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const normalized = v.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatDateBR(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

async function loadEquipments(): Promise<EquipOption[]> {
  let data: any[] | null = null;

  {
    const r = await supabase
      .from("equipament_costs_2025")
      .select("equipamento")
      .limit(2000);
    if (!r.error) data = r.data as any[];
  }

  if (!data) {
    const r2 = await supabase
      .from("equipment_costs_2025")
      .select("equipamento")
      .limit(2000);
    if (!r2.error) data = r2.data as any[];
  }

  const set = new Set<string>();
  for (const row of data || []) {
    const v = String(row?.equipamento || "").trim();
    if (v) set.add(v);
  }

  return Array.from(set)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((v) => ({ value: v }));
}

async function uploadToDieselBucket(file: File, path: string) {
  const { error } = await supabase.storage.from("diesel").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

async function buildComprovantePNG(args: {
  dateLabel: string;
  solicitante: string;
  equipamento: string;
  horimetroLabel: string;
  odometroLabel: string;
  litrosLabel: string;
  fotos: Array<{ label: string; file: File | null }>;
}): Promise<Blob> {
  const W = 1400;
  const H = 1050;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const pad = 48;
  const headerH = 260;

  ctx.fillStyle = "#0b1220";
  ctx.font =
    "700 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("ABASTECIMENTO • DIESEL", pad, 80);

  ctx.fillStyle = "#334155";
  ctx.font =
    "500 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Data: ${args.dateLabel}`, pad, 130);

  ctx.fillStyle = "#0f172a";
  ctx.font =
    "700 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Equipamento: ${args.equipamento}`, pad, 185);

  ctx.fillStyle = "#334155";
  ctx.font =
    "500 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Solicitante: ${args.solicitante}`, pad, 230);

  const boxX = W - pad - 520;
  const boxY = 95;
  const boxW = 520;
  const boxH = 155;

  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(boxX, boxY, boxW, boxH);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);

  ctx.fillStyle = "#0f172a";
  ctx.font =
    "700 28px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Litros: ${args.litrosLabel}`, boxX + 24, boxY + 52);

  ctx.fillStyle = "#334155";
  ctx.font =
    "600 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Horímetro: ${args.horimetroLabel}`, boxX + 24, boxY + 98);
  ctx.fillText(`Odômetro: ${args.odometroLabel}`, boxX + 24, boxY + 136);

  const gridTop = headerH + 10;
  const gap = 18;
  const cellW = Math.floor((W - pad * 2 - gap) / 2);
  const cellH = Math.floor((H - gridTop - pad - gap) / 2);

  const slots = [
    { x: pad, y: gridTop, title: args.fotos[0]?.label || "Foto 1" },
    {
      x: pad + cellW + gap,
      y: gridTop,
      title: args.fotos[1]?.label || "Foto 2",
    },
    {
      x: pad,
      y: gridTop + cellH + gap,
      title: args.fotos[2]?.label || "Foto 3",
    },
    {
      x: pad + cellW + gap,
      y: gridTop + cellH + gap,
      title: args.fotos[3]?.label || "Foto 4",
    },
  ];

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;

  const urlsToRevoke: string[] = [];

  for (let i = 0; i < 4; i++) {
    const slot = slots[i];
    const f = args.fotos[i]?.file || null;

    ctx.fillStyle = "#0f172a";
    ctx.font =
      "700 22px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillText(slot.title, slot.x, slot.y - 10);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(slot.x, slot.y, cellW, cellH);
    ctx.strokeRect(slot.x, slot.y, cellW, cellH);

    if (!f) {
      ctx.fillStyle = "#94a3b8";
      ctx.font =
        "600 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("SEM FOTO", slot.x + 30, slot.y + 60);
      continue;
    }

    const objectUrl = URL.createObjectURL(f);
    urlsToRevoke.push(objectUrl);

    const img = new Image();
    img.decoding = "async";
    img.src = objectUrl;

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Falha ao carregar uma das fotos"));
    });

    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    const scale = Math.max(cellW / iw, cellH / ih);
    const dw = iw * scale;
    const dh = ih * scale;

    const dx = slot.x + (cellW - dw) / 2;
    const dy = slot.y + (cellH - dh) / 2;

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  ctx.fillStyle = "#94a3b8";
  ctx.font =
    "500 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("GP Asfalto • Registro interno", pad, H - 24);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Falha ao gerar PNG"))),
      "image/png",
      0.92
    );
  });

  for (const u of urlsToRevoke) URL.revokeObjectURL(u);

  return blob;
}

export default function DieselNovoPage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);

  const [solicitante, setSolicitante] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [equipOptions, setEquipOptions] = useState<EquipOption[]>([]);
  const [equipLoading, setEquipLoading] = useState(true);

  const [horimetro, setHorimetro] = useState("");
  const [odometro, setOdometro] = useState("");
  const [litros, setLitros] = useState("");
  const [obs, setObs] = useState("");

  const [fotoEquip, setFotoEquip] = useState<File | null>(null);
  const [fotoHor, setFotoHor] = useState<File | null>(null);
  const [fotoOdo, setFotoOdo] = useState<File | null>(null);
  const [fotoExtra, setFotoExtra] = useState<File | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);
  const comprovanteBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setEquipLoading(true);
        const list = await loadEquipments();
        setEquipOptions(list);
      } catch {
        // ok: pode digitar manual
      } finally {
        setEquipLoading(false);
      }
    })();
  }, []);

  const styles = useMemo(() => {
    const input: React.CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "var(--gp-text)",
      outline: "none",
      fontSize: 14,
    };

    const label: React.CSSProperties = {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--gp-muted)",
      marginBottom: 6,
      display: "block",
      letterSpacing: "0.02em",
      textTransform: "uppercase",
    };

    const hint: React.CSSProperties = {
      fontSize: 12,
      color: "var(--gp-muted-soft)",
      marginTop: 6,
    };

    const btnPrimary: React.CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid #111827",
      background: "#111827",
      color: "#fff",
      fontWeight: 700,
      fontSize: 14,
      cursor: "pointer",
    };

    const btnSecondary: React.CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "var(--gp-text)",
      fontWeight: 700,
      fontSize: 14,
      cursor: "pointer",
    };

    const btnAccent: React.CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid var(--gp-accent)",
      background: "var(--gp-accent)",
      color: "#fff",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
    };

    return { input, label, hint, btnPrimary, btnSecondary, btnAccent };
  }, []);

  function buildResumoTexto(args: {
    dateLabel: string;
    solicitante: string;
    equipamento: string;
    hor: string;
    odo: string;
    litros: string;
    id: string;
  }) {
    return [
      `🛢️ *Abastecimento Diesel*`,
      `📅 Data: ${args.dateLabel}`,
      `👤 Solicitante: ${args.solicitante}`,
      `🚜 Equipamento: ${args.equipamento}`,
      `⏱️ Horímetro: ${args.hor}`,
      `🧭 Odômetro: ${args.odo}`,
      `⛽ Litros: ${args.litros}`,
      `🆔 ID: ${args.id}`,
    ].join("\n");
  }

  async function handleSave() {
    setError(null);
    setSavedId(null);
    setComprovanteUrl(null);
    comprovanteBlobRef.current = null;

    const solicit = solicitante.trim();
    const equip = equipamento.trim();

    const litrosN = parseDecimalBR(litros);
    const horN = parseDecimalBR(horimetro);
    const odoN = odometro.trim() ? Number.parseInt(onlyDigits(odometro), 10) : null;

    if (!solicit) return setError("Informe o solicitante.");
    if (!equip) return setError("Selecione/Informe o equipamento.");
    if (litrosN === null || litrosN <= 0) return setError("Informe os litros (valor > 0).");

    if (!fotoEquip) return setError("Envie a foto do código/placa do equipamento.");
    if (!fotoHor) return setError("Envie a foto do horímetro.");
    if (!fotoOdo) return setError("Envie a foto do odômetro/painel.");

    setSaving(true);
    try {
      const id = crypto.randomUUID();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      const base = `diesel/${y}-${m}/${equip}/${id}`;

      const foto_equip_path = await uploadToDieselBucket(fotoEquip, `${base}/01_equip.jpg`);
      const foto_horimetro_path = await uploadToDieselBucket(fotoHor, `${base}/02_horimetro.jpg`);
      const foto_odometro_path = await uploadToDieselBucket(fotoOdo, `${base}/03_odometro.jpg`);
      const foto_extra_path = fotoExtra
        ? await uploadToDieselBucket(fotoExtra, `${base}/04_extra.jpg`)
        : null;

      const { data: ins, error: insErr } = await supabase
        .from("diesel_logs")
        .insert({
          id,
          log_date: `${y}-${m}-${d}`,
          solicitante: solicit,
          equipamento: equip,
          horimetro: horN,
          odometro: odoN,
          litros: litrosN,
          observacao: obs.trim() || null,
          foto_equip_path,
          foto_horimetro_path,
          foto_odometro_path,
          foto_extra_path,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      const dateLabel = formatDateBR(today);
      const horLabel = horN === null ? "-" : horimetro;
      const odoLabel = odoN === null ? "-" : String(odoN);
      const litrosLabel = litros;

      const comprovanteBlob = await buildComprovantePNG({
        dateLabel,
        solicitante: solicit,
        equipamento: equip,
        horimetroLabel: horLabel,
        odometroLabel: odoLabel,
        litrosLabel,
        fotos: [
          { label: "Código / Placa", file: fotoEquip },
          { label: "Horímetro", file: fotoHor },
          { label: "Odômetro", file: fotoOdo },
          { label: "Extra", file: fotoExtra },
        ],
      });

      comprovanteBlobRef.current = comprovanteBlob;

      const comprovanteFile = new File([comprovanteBlob], "comprovante.png", {
        type: "image/png",
      });

      const comprovante_path = await uploadToDieselBucket(comprovanteFile, `${base}/comprovante.png`);

      const { error: upErr } = await supabase
        .from("diesel_logs")
        .update({ comprovante_path })
        .eq("id", id);

      if (upErr) throw upErr;

      const localUrl = URL.createObjectURL(comprovanteBlob);
      setComprovanteUrl(localUrl);
      setSavedId(ins?.id || id);
    } catch (e: any) {
      setError(e?.message || "Falha ao salvar abastecimento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyResumo() {
    if (!savedId) return;

    const dateLabel = formatDateBR(today);
    const horLabel = horimetro.trim() ? horimetro.trim() : "-";
    const odoLabel = odometro.trim() ? onlyDigits(odometro.trim()) : "-";
    const litrosLabel = litros.trim();

    const txt = buildResumoTexto({
      dateLabel,
      solicitante: solicitante.trim(),
      equipamento: equipamento.trim(),
      hor: horLabel,
      odo: odoLabel,
      litros: litrosLabel,
      id: savedId,
    });

    await navigator.clipboard.writeText(txt);
  }

  async function handleShare() {
    if (!savedId) return;
    const blob = comprovanteBlobRef.current;
    if (!blob) return;

    const file = new File([blob], "abastecimento.png", { type: "image/png" });

    const dateLabel = formatDateBR(today);
    const horLabel = horimetro.trim() ? horimetro.trim() : "-";
    const odoLabel = odometro.trim() ? onlyDigits(odometro.trim()) : "-";
    const litrosLabel = litros.trim();

    const txt = buildResumoTexto({
      dateLabel,
      solicitante: solicitante.trim(),
      equipamento: equipamento.trim(),
      hor: horLabel,
      odo: odoLabel,
      litros: litrosLabel,
      id: savedId,
    });

    const canShareFiles =
      typeof (navigator as any).canShare === "function" &&
      (navigator as any).canShare({ files: [file] });

    if (navigator.share && canShareFiles) {
      await navigator.share({
        title: "Abastecimento Diesel",
        text: txt,
        files: [file],
      });
      return;
    }

    await handleCopyResumo();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "abastecimento.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-root">
      <div className="page-container">
        {/* Header (mesmo “clima” do dashboard) */}
        <div className="page-header">
          <div className="brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="brand-logo" />
            <div>
              <div className="brand-text-main">Abastecimento • Diesel</div>
              <div className="brand-text-sub">Módulo operacional (fotos + comprovante)</div>
            </div>
          </div>

          <div className="header-right">
            <span className="header-pill">Operacional</span>
          </div>
        </div>

        {/* Form */}
        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo lançamento</div>
              <div className="section-subtitle">Preencha e envie as fotos. O sistema gera um PNG para WhatsApp.</div>
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gap: 14,
            }}
          >
            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Data</label>
              <input style={{ ...styles.input, background: "#f9fafb" }} value={formatDateBR(today)} disabled />
            </div>

            <div style={{ gridColumn: "span 8" }}>
              <label style={styles.label}>Solicitante *</label>
              <input
                style={styles.input}
                value={solicitante}
                onChange={(e) => setSolicitante(e.target.value)}
                placeholder="Ex.: João / Valéria"
              />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Equipamento *</label>
              <input
                style={styles.input}
                value={equipamento}
                onChange={(e) => setEquipamento(e.target.value)}
                placeholder={equipLoading ? "Carregando lista..." : "Ex.: CB08 / Placa / Código"}
                list="equipamentos-list"
              />
              <datalist id="equipamentos-list">
                {equipOptions.map((o) => (
                  <option key={o.value} value={o.value} />
                ))}
              </datalist>
              <div style={styles.hint}>Você pode escolher da lista ou digitar manualmente.</div>
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Horímetro</label>
              <input
                style={styles.input}
                value={horimetro}
                onChange={(e) => setHorimetro(normalizeDecimalBRInput(e.target.value))}
                placeholder="Ex.: 1234,50"
                inputMode="decimal"
              />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Odômetro</label>
              <input
                style={styles.input}
                value={odometro}
                onChange={(e) => setOdometro(onlyDigits(e.target.value))}
                placeholder="Ex.: 156872"
                inputMode="numeric"
              />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Litros *</label>
              <input
                style={styles.input}
                value={litros}
                onChange={(e) => setLitros(normalizeDecimalBRInput(e.target.value))}
                placeholder="Ex.: 80,00"
                inputMode="decimal"
              />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Observação</label>
              <input style={styles.input} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div style={{ height: 18 }} />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(12, 1fr)",
              gap: 14,
            }}
          >
            <div style={{ gridColumn: "span 6" }}>
              <FileField label="Foto do código / placa *" file={fotoEquip} onFile={setFotoEquip} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <FileField label="Foto do horímetro *" file={fotoHor} onFile={setFotoHor} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <FileField label="Foto do odômetro/painel *" file={fotoOdo} onFile={setFotoOdo} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <FileField label="Foto extra (opcional)" file={fotoExtra} onFile={setFotoExtra} />
            </div>
          </div>

          <div style={{ height: 18 }} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
            <button onClick={handleSave} disabled={saving} style={{ ...styles.btnPrimary, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Salvando..." : "Salvar abastecimento"}
            </button>

            <button onClick={() => router.push("/dashboard")} style={styles.btnSecondary}>
              Voltar
            </button>
          </div>
        </div>

        {/* Salvo */}
        {savedId ? (
          <div className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Salvo ✅</div>
                <div className="section-subtitle">
                  ID: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{savedId}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={handleCopyResumo} style={styles.btnSecondary}>
                  Copiar resumo
                </button>
                <button onClick={handleShare} style={styles.btnAccent}>
                  Enviar/Compartilhar
                </button>
              </div>
            </div>

            {comprovanteUrl ? (
              <div>
                <div className="section-subtitle" style={{ marginBottom: 10 }}>
                  Comprovante (preview)
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={comprovanteUrl}
                  alt="Comprovante"
                  style={{
                    width: "100%",
                    borderRadius: 18,
                    border: "1px solid #e5e7eb",
                    display: "block",
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FileField({
  label,
  file,
  onFile,
}: {
  label: string;
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      if (preview) URL.revokeObjectURL(preview);
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  return (
    <div
      style={{
        borderRadius: 18,
        padding: 14,
        background: "var(--gp-surface)",
        border: "1px solid #e5e7eb",
        boxShadow: "0 10px 26px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "var(--gp-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 10,
        }}
      >
        {label}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 12px",
            borderRadius: 14,
            background: "#f9fafb",
            border: "1px solid #e5e7eb",
            fontWeight: 700,
            cursor: "pointer",
            color: "var(--gp-text)",
            fontSize: 14,
          }}
        >
          Tirar/Enviar foto
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
        </label>

        {file ? (
          <button
            type="button"
            onClick={() => onFile(null)}
            style={{
              padding: "10px 12px",
              borderRadius: 14,
              background: "#fff",
              border: "1px solid #e5e7eb",
              fontWeight: 700,
              cursor: "pointer",
              color: "var(--gp-muted)",
              fontSize: 14,
            }}
          >
            Remover
          </button>
        ) : null}
      </div>

      {preview ? (
        <div style={{ marginTop: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Prévia"
            style={{
              width: "100%",
              height: 170,
              objectFit: "cover",
              borderRadius: 16,
              border: "1px solid #e5e7eb",
              display: "block",
            }}
          />
        </div>
      ) : (
        <div
          style={{
            marginTop: 12,
            borderRadius: 16,
            border: "1px dashed #e5e7eb",
            background: "#f9fafb",
            padding: "24px 12px",
            textAlign: "center",
            color: "var(--gp-muted-soft)",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          Sem foto
        </div>
      )}
    </div>
  );
}

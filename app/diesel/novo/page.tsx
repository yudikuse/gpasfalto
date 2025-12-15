"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import OcrHint from "@/components/OcrHint";

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

async function uploadTempToDieselBucket(file: File, path: string) {
  const { error } = await supabase.storage.from("diesel").upload(path, file, {
    cacheControl: "60",
    upsert: true, // temp pode sobrescrever
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

function extFromFile(file: File) {
  const t = (file.type || "").toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  return "jpg";
}

async function tempSignedUrl(sessionId: string, name: string, file: File) {
  const ext = extFromFile(file);
  const path = `tmp/ocr/${sessionId}/${name}.${ext}`;

  await uploadTempToDieselBucket(file, path);

  const { data, error } = await supabase.storage
    .from("diesel")
    .createSignedUrl(path, 60 * 10); // 10 min

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("Falha ao gerar signedUrl do OCR");
  return data.signedUrl;
}

async function buildComprovantePNG(args: {
  dateLabel: string;
  solicitante: string;
  equipamento: string;
  horimetroLabel: string;
  odometroLabel: string;
  litrosLabel: string;
  fotos: Array<{ label: string; file: File }>;
}): Promise<Blob> {
  const W = 1400;
  const H = 1050;

  const generatedAt = new Date();
  const generatedAtLabel = generatedAt.toLocaleString("pt-BR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");

  function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCard(x: number, y: number, w: number, h: number) {
    ctx.save();
    ctx.shadowColor = "rgba(15, 23, 42, 0.08)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 10;

    ctx.fillStyle = "#ffffff";
    roundRectPath(x, y, w, h, 18);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(x, y, w, h, 18);
    ctx.stroke();
  }

  function drawPill(text: string, x: number, y: number) {
    ctx.save();
    ctx.font =
      "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const m = ctx.measureText(text);
    const padX = 12;
    const w = Math.ceil(m.width + padX * 2);
    const h = 34;

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(x, y, w, h, 999);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#0f172a";
    ctx.fillText(text, x + padX, y + 24);
    ctx.restore();
  }

  function drawTextFit(
    text: string,
    x: number,
    y: number,
    maxW: number,
    fontSizes: number[],
    weight = 800
  ) {
    for (const size of fontSizes) {
      ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      if (ctx.measureText(text).width <= maxW) {
        ctx.fillText(text, x, y);
        return;
      }
    }
    ctx.font = `${weight} ${fontSizes[fontSizes.length - 1]}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillText(text, x, y);
  }

  // Fundo
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, W, H);

  const pad = 44;

  // Card principal
  const mainX = pad;
  const mainY = pad;
  const mainW = W - pad * 2;
  const mainH = H - pad * 2;
  drawCard(mainX, mainY, mainW, mainH);

  // Header
  const leftX = mainX + 36;

  const titleY = mainY + 78;
  const dateY = titleY + 46;
  const equipY = dateY + 60;
  const solicitY = equipY + 44;

  ctx.fillStyle = "#0b1220";
  ctx.font =
    "800 44px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("ABASTECIMENTO • DIESEL", leftX, titleY);

  ctx.fillStyle = "#334155";
  ctx.font =
    "600 26px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Data: ${args.dateLabel}`, leftX, dateY);

  ctx.fillStyle = "#0f172a";
  drawTextFit(
    `Equipamento: ${args.equipamento}`,
    leftX,
    equipY,
    mainW - 36 - 560,
    [34, 32, 30, 28],
    800
  );

  ctx.fillStyle = "#334155";
  drawTextFit(
    `Solicitante: ${args.solicitante}`,
    leftX,
    solicitY,
    mainW - 36 - 560,
    [26, 24, 22],
    700
  );

  // KPI à direita
  const kpiW = 520;
  const kpiH = 178;
  const kpiX = mainX + mainW - 36 - kpiW;
  const kpiY = mainY + 104;

  ctx.fillStyle = "#eef2f7";
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 2;
  roundRectPath(kpiX, kpiY, kpiW, kpiH, 18);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0f172a";
  ctx.font =
    "800 34px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Litros: ${args.litrosLabel}`, kpiX + 28, kpiY + 66);

  ctx.fillStyle = "#334155";
  ctx.font =
    "700 24px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText(`Horímetro: ${args.horimetroLabel}`, kpiX + 28, kpiY + 114);
  ctx.fillText(`Odômetro: ${args.odometroLabel}`, kpiX + 28, kpiY + 148);

  // divisor
  const headerBottom = mainY + 300;
  ctx.strokeStyle = "#eef2f7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mainX + 24, headerBottom);
  ctx.lineTo(mainX + mainW - 24, headerBottom);
  ctx.stroke();

  // Fotos
  const photosTop = headerBottom + 22;
  const photosX = mainX + 26;
  const photosW = mainW - 52;
  const footerH = 64;
  const photosH = mainY + mainH - footerH - photosTop;
  const gap = 18;

  const cellW = Math.floor((photosW - gap) / 2);
  const cellH = Math.floor((photosH - gap) / 2);

  const slots = [
    { x: photosX, y: photosTop, label: args.fotos[0].label, file: args.fotos[0].file },
    { x: photosX + cellW + gap, y: photosTop, label: args.fotos[1].label, file: args.fotos[1].file },
    { x: photosX, y: photosTop + cellH + gap, label: args.fotos[2].label, file: args.fotos[2].file },
    { x: photosX + cellW + gap, y: photosTop + cellH + gap, label: args.fotos[3].label, file: args.fotos[3].file },
  ];

  const urlsToRevoke: string[] = [];

  for (const s of slots) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 2;
    roundRectPath(s.x, s.y, cellW, cellH, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#f8fafc";
    roundRectPath(s.x + 10, s.y + 10, cellW - 20, cellH - 20, 14);
    ctx.fill();

    drawPill(s.label, s.x + 18, s.y + 18);

    const objectUrl = URL.createObjectURL(s.file);
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

    const innerPad = 18;
    const usableX = s.x + innerPad;
    const usableY = s.y + 58;
    const usableW = cellW - innerPad * 2;
    const usableH = cellH - 58 - innerPad;

    const scale = Math.min(usableW / iw, usableH / ih);
    const dw = Math.max(1, Math.floor(iw * scale));
    const dh = Math.max(1, Math.floor(ih * scale));
    const dx = Math.floor(usableX + (usableW - dw) / 2);
    const dy = Math.floor(usableY + (usableH - dh) / 2);

    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // Rodapé
  const footerY = mainY + mainH - 26;

  ctx.fillStyle = "#94a3b8";
  ctx.font =
    "700 18px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.fillText("GP Asfalto • Registro interno", leftX, footerY);

  const rightText = `Gerado em: ${generatedAtLabel}`;
  const rightW = ctx.measureText(rightText).width;
  ctx.fillText(rightText, mainX + mainW - 36 - rightW, footerY);

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
  const ocrSessionId = useMemo(() => crypto.randomUUID(), []);

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
  const [fotoAbast, setFotoAbast] = useState<File | null>(null);

  // signed urls temporárias para OCR
  const [ocrHorUrl, setOcrHorUrl] = useState<string | null>(null);
  const [ocrOdoUrl, setOcrOdoUrl] = useState<string | null>(null);
  const [ocrLitrosUrl, setOcrLitrosUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedId, setSavedId] = useState<string | null>(null);
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);
  const [comprovanteSignedUrl, setComprovanteSignedUrl] = useState<string | null>(null);

  const comprovanteBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setEquipLoading(true);
        const list = await loadEquipments();
        setEquipOptions(list);
      } catch {
        // ok
      } finally {
        setEquipLoading(false);
      }
    })();
  }, []);

  // ===== OCR: gera signedUrl temp ao anexar fotos =====
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!fotoHor) {
        setOcrHorUrl(null);
        return;
      }
      try {
        const url = await tempSignedUrl(ocrSessionId, "horimetro", fotoHor);
        if (alive) setOcrHorUrl(url);
      } catch {
        if (alive) setOcrHorUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fotoHor, ocrSessionId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!fotoOdo) {
        setOcrOdoUrl(null);
        return;
      }
      try {
        const url = await tempSignedUrl(ocrSessionId, "odometro", fotoOdo);
        if (alive) setOcrOdoUrl(url);
      } catch {
        if (alive) setOcrOdoUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fotoOdo, ocrSessionId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!fotoAbast) {
        setOcrLitrosUrl(null);
        return;
      }
      try {
        const url = await tempSignedUrl(ocrSessionId, "abastecimento", fotoAbast);
        if (alive) setOcrLitrosUrl(url);
      } catch {
        if (alive) setOcrLitrosUrl(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fotoAbast, ocrSessionId]);

  const styles = useMemo(() => {
    const input: CSSProperties = {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "var(--gp-text)",
      outline: "none",
      fontSize: 14,
    };

    const label: CSSProperties = {
      fontSize: 12,
      fontWeight: 600,
      color: "var(--gp-muted)",
      marginBottom: 6,
      display: "block",
      letterSpacing: "0.02em",
      textTransform: "uppercase",
    };

    const hint: CSSProperties = {
      fontSize: 12,
      color: "var(--gp-muted-soft)",
      marginTop: 6,
    };

    const btnPrimary: CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid #111827",
      background: "#111827",
      color: "#fff",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
    };

    const btnSecondary: CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "var(--gp-text)",
      fontWeight: 800,
      fontSize: 14,
      cursor: "pointer",
    };

    const btnAccent: CSSProperties = {
      padding: "10px 14px",
      borderRadius: 14,
      border: "1px solid var(--gp-accent)",
      background: "var(--gp-accent)",
      color: "#fff",
      fontWeight: 900,
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
    link?: string | null;
  }) {
    const lines = [
      `🛢️ *Abastecimento Diesel*`,
      `📅 Data: ${args.dateLabel}`,
      `👤 Solicitante: ${args.solicitante}`,
      `🚜 Equipamento: ${args.equipamento}`,
      `⏱️ Horímetro: ${args.hor}`,
      `🧭 Odômetro: ${args.odo}`,
      `⛽ Litros: ${args.litros}`,
      `🆔 ID: ${args.id}`,
    ];
    if (args.link) lines.push(`📎 Comprovante: ${args.link}`);
    return lines.join("\n");
  }

  async function handleSave() {
    setError(null);
    setSavedId(null);
    setComprovanteUrl(null);
    setComprovanteSignedUrl(null);
    comprovanteBlobRef.current = null;

    const solicit = solicitante.trim();
    const equip = equipamento.trim();

    const litrosN = parseDecimalBR(litros);
    const horN = parseDecimalBR(horimetro);
    const odoN = odometro.trim()
      ? Number.parseInt(onlyDigits(odometro), 10)
      : null;

    if (!solicit) return setError("Informe o solicitante.");
    if (!equip) return setError("Selecione/Informe o equipamento.");
    if (litrosN === null || litrosN <= 0) return setError("Informe os litros (valor > 0).");
    if (horN === null) return setError("Informe o horímetro.");

    if (!fotoEquip) return setError("Envie a foto do código/placa do equipamento.");
    if (!fotoHor) return setError("Envie a foto do horímetro.");
    if (!fotoOdo) return setError("Envie a foto do odômetro/painel.");
    if (!fotoAbast) return setError("Envie a foto do abastecimento (onde aparece os litros).");

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
      const foto_extra_path = await uploadToDieselBucket(fotoAbast, `${base}/04_abastecimento.jpg`);

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
      const horLabel = horimetro.trim();
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
          { label: "Abastecimento (Litros)", file: fotoAbast },
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

      try {
        const { data: signed, error: sErr } = await supabase.storage
          .from("diesel")
          .createSignedUrl(comprovante_path, 60 * 60 * 24 * 7);

        if (!sErr && signed?.signedUrl) setComprovanteSignedUrl(signed.signedUrl);
      } catch {
        // ok
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao salvar abastecimento.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyResumo() {
    if (!savedId) return;

    const txt = buildResumoTexto({
      dateLabel: formatDateBR(today),
      solicitante: solicitante.trim(),
      equipamento: equipamento.trim(),
      hor: horimetro.trim(),
      odo: odometro.trim() ? onlyDigits(odometro.trim()) : "-",
      litros: litros.trim(),
      id: savedId,
      link: comprovanteSignedUrl,
    });

    await navigator.clipboard.writeText(txt);
  }

  async function handleDownloadPNG() {
    const blob = comprovanteBlobRef.current;
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "abastecimento.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleWhatsApp() {
    if (!savedId) return;

    const blob = comprovanteBlobRef.current;
    const file = blob ? new File([blob], "abastecimento.png", { type: "image/png" }) : null;

    const txt = buildResumoTexto({
      dateLabel: formatDateBR(today),
      solicitante: solicitante.trim(),
      equipamento: equipamento.trim(),
      hor: horimetro.trim(),
      odo: odometro.trim() ? onlyDigits(odometro.trim()) : "-",
      litros: litros.trim(),
      id: savedId,
      link: comprovanteSignedUrl,
    });

    const canShareFiles =
      !!file &&
      typeof (navigator as any).canShare === "function" &&
      (navigator as any).canShare({ files: [file] });

    if (file && navigator.share && canShareFiles) {
      await navigator.share({
        title: "Abastecimento Diesel",
        text: txt,
        files: [file],
      });
      return;
    }

    const wa = `https://wa.me/?text=${encodeURIComponent(txt)}`;
    window.open(wa, "_blank", "noopener,noreferrer");

    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      // ok
    }
  }

  return (
    <div className="page-root">
      <div className="page-container">
        {/* HEADER PADRONIZADO (mesmas classes do dashboard) */}
        <header
          className="page-header"
          style={{ flexDirection: "column", alignItems: "center", gap: "8px" }}
        >
          <div
            className="brand"
            style={{ flexDirection: "column", alignItems: "center", gap: "8px" }}
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
              <div className="brand-text-main">Abastecimento • Diesel</div>
              <div className="brand-text-sub">
                Lançamento operacional • Fotos + comprovante
              </div>
            </div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Novo lançamento</div>
              <div className="section-subtitle">
                Envie as fotos e gere o comprovante para registrar no WhatsApp.
              </div>
            </div>
          </div>

          {error ? (
            <div
              className="state-card"
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
              <label style={styles.label}>Data</label>
              <input style={{ ...styles.input, background: "#f9fafb" }} value={formatDateBR(today)} disabled />
            </div>

            <div style={{ gridColumn: "span 8" }}>
              <label style={styles.label}>Solicitante *</label>
              <input
                style={styles.input}
                value={solicitante}
                onChange={(e) => setSolicitante(e.target.value)}
                placeholder="Ex.: Lucas Almeida"
              />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Equipamento *</label>
              <input
                style={styles.input}
                value={equipamento}
                onChange={(e) => setEquipamento(e.target.value)}
                placeholder={equipLoading ? "Carregando lista..." : "Ex.: CB-08 / Placa / Código"}
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
              <label style={styles.label}>Horímetro *</label>
              <input
                style={styles.input}
                value={horimetro}
                onChange={(e) => setHorimetro(normalizeDecimalBRInput(e.target.value))}
                placeholder="Ex.: 11145,2"
                inputMode="decimal"
              />
              <OcrHint
                kind="horimetro"
                imageUrl={ocrHorUrl}
                currentValue={horimetro}
                autoApplyIfEmpty={true}
                onApply={(v) => setHorimetro(normalizeDecimalBRInput(v))}
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
              <OcrHint
                kind="odometro"
                imageUrl={ocrOdoUrl}
                currentValue={odometro}
                autoApplyIfEmpty={true}
                onApply={(v) => setOdometro(onlyDigits(v))}
              />
            </div>

            <div style={{ gridColumn: "span 4" }}>
              <label style={styles.label}>Litros *</label>
              <input
                style={styles.input}
                value={litros}
                onChange={(e) => setLitros(normalizeDecimalBRInput(e.target.value))}
                placeholder="Ex.: 123,1"
                inputMode="decimal"
              />
              <OcrHint
                kind="abastecimento"
                imageUrl={ocrLitrosUrl}
                currentValue={litros}
                autoApplyIfEmpty={true}
                onApply={(v) => setLitros(normalizeDecimalBRInput(v))}
              />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Observação</label>
              <input
                style={styles.input}
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div style={{ height: 18 }} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
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
              <FileField label="Foto do abastecimento (Litros) *" file={fotoAbast} onFile={setFotoAbast} />
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

        {savedId ? (
          <div className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Salvo ✅</div>
                <div className="section-subtitle">
                  ID:{" "}
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {savedId}
                  </span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={handleCopyResumo} style={styles.btnSecondary}>
                  Copiar resumo
                </button>
                <button onClick={handleDownloadPNG} style={styles.btnSecondary}>
                  Baixar PNG
                </button>
                <button onClick={handleWhatsApp} style={styles.btnAccent}>
                  WhatsApp
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
                    background: "#fff",
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
            fontWeight: 800,
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
              fontWeight: 800,
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
            fontWeight: 700,
          }}
        >
          Sem foto
        </div>
      )}
    </div>
  );
}

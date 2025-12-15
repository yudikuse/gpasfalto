// FILE: app/diesel/novo/page.tsx
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
    { x: pad + cellW + gap, y: gridTop, title: args.fotos[1]?.label || "Foto 2" },
    { x: pad, y: gridTop + cellH + gap, title: args.fotos[2]?.label || "Foto 3" },
    { x: pad + cellW + gap, y: gridTop + cellH + gap, title: args.fotos[3]?.label || "Foto 4" },
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
        // sem travar: ainda pode digitar manual
      } finally {
        setEquipLoading(false);
      }
    })();
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

      const comprovante_path = await uploadToDieselBucket(
        comprovanteFile,
        `${base}/comprovante.png`
      );

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
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-slate-900">Abastecimento • Diesel</h1>
        <p className="text-sm text-slate-600">
          Lançamento operacional com fotos + comprovante (PNG) para WhatsApp.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Data</label>
            <input
              value={formatDateBR(today)}
              disabled
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Solicitante *</label>
            <input
              value={solicitante}
              onChange={(e) => setSolicitante(e.target.value)}
              placeholder="Ex.: João / Valéria"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">Equipamento *</label>

            <input
              value={equipamento}
              onChange={(e) => setEquipamento(e.target.value)}
              placeholder={equipLoading ? "Carregando lista..." : "Ex.: CB08 / Placa / Código"}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
              list="equipamentos-list"
            />

            <datalist id="equipamentos-list">
              {equipOptions.map((o) => (
                <option key={o.value} value={o.value} />
              ))}
            </datalist>

            <p className="mt-1 text-xs text-slate-500">
              Você pode escolher da lista ou digitar manualmente.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Horímetro</label>
            <input
              value={horimetro}
              onChange={(e) => setHorimetro(normalizeDecimalBRInput(e.target.value))}
              placeholder="Ex.: 1234,50"
              inputMode="decimal"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Odômetro</label>
            <input
              value={odometro}
              onChange={(e) => setOdometro(onlyDigits(e.target.value))}
              placeholder="Ex.: 156872"
              inputMode="numeric"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Litros *</label>
            <input
              value={litros}
              onChange={(e) => setLitros(normalizeDecimalBRInput(e.target.value))}
              placeholder="Ex.: 80,00"
              inputMode="decimal"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Observação</label>
            <input
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none focus:border-slate-400"
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FileField label="Foto do código / placa *" file={fotoEquip} onFile={setFotoEquip} />
          <FileField label="Foto do horímetro *" file={fotoHor} onFile={setFotoHor} />
          <FileField label="Foto do odômetro/painel *" file={fotoOdo} onFile={setFotoOdo} />
          <FileField label="Foto extra (opcional)" file={fotoExtra} onFile={setFotoExtra} />
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar abastecimento"}
          </button>

          <button
            onClick={() => router.push("/dashboard")}
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Voltar
          </button>
        </div>
      </div>

      {savedId ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Salvo ✅</h2>
              <p className="text-sm text-slate-600">
                ID: <span className="font-mono">{savedId}</span>
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={handleCopyResumo}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Copiar resumo
              </button>

              <button
                onClick={handleShare}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                Enviar/Compartilhar
              </button>
            </div>
          </div>

          {comprovanteUrl ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Comprovante (preview)</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={comprovanteUrl}
                alt="Comprovante"
                className="w-full rounded-xl border border-slate-200"
              />
            </div>
          ) : null}
        </div>
      ) : null}
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 text-sm font-medium text-slate-700">{label}</div>

      <div className="flex items-center gap-3">
        <label className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          Tirar/Enviar foto
        </label>

        {file ? (
          <button
            type="button"
            onClick={() => onFile(null)}
            className="text-sm font-semibold text-slate-500 hover:text-slate-700"
          >
            Remover
          </button>
        ) : null}
      </div>

      {preview ? (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Prévia"
            className="h-32 w-full rounded-xl border border-slate-200 object-cover"
          />
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          Sem foto
        </div>
      )}
    </div>
  );
}

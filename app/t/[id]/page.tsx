// FILE: app/t/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type MaterialTicketRow = {
  id: number;
  created_at: string;
  tipo: string | null;
  veiculo: string | null;
  origem: string | null;
  destino: string | null;
  material: string | null;
  data: string | null; // yyyy-mm-dd
  horario: string | null; // hh:mm:ss
  peso_t: number | null;
  arquivo_path: string | null; // ex: material/2026-01-15/xxx.jpg
  arquivo_nome: string | null;
  arquivo_mime: string | null;
  arquivo_size: number | null;
};

function getEnv(name: string) {
  const v = (process.env as any)[name];
  return typeof v === "string" ? v.trim() : "";
}

function formatPeso(peso: number | null | undefined) {
  if (peso === null || peso === undefined || Number.isNaN(peso)) return "-";
  return Number(peso).toFixed(3);
}

function brDateFromISO(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "-";
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function buildShareText(row: MaterialTicketRow, shortUrl: string) {
  const tipo = (row.tipo || "TICKET").toUpperCase();
  const dt =
    row.data && row.horario
      ? `${brDateFromISO(row.data)} ${row.horario}`
      : row.data
        ? brDateFromISO(row.data)
        : row.created_at
          ? new Date(row.created_at).toLocaleString("pt-BR")
          : "";

  const lines = [
    `✅ Ticket de ${tipo}`,
    `ID: ${row.id}`,
    row.veiculo ? `Veículo: ${row.veiculo}` : null,
    dt ? `Data/Hora: ${dt}` : null,
    row.origem ? `Origem: ${row.origem}` : null,
    row.destino ? `Destino: ${row.destino}` : null,
    row.material ? `Material: ${row.material}` : null,
    row.peso_t != null ? `Peso (t): ${formatPeso(row.peso_t)}` : null,
    "",
    `Ver foto e detalhes: ${shortUrl}`,
  ].filter(Boolean) as string[];

  return lines.join("\n");
}

export default function TicketPage() {
  const params = useParams<{ id: string }>();
  const idRaw = typeof params?.id === "string" ? params.id : "";
  const idNum = useMemo(() => {
    const n = Number.parseInt(idRaw, 10);
    return Number.isFinite(n) ? n : NaN;
  }, [idRaw]);

  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const supabaseKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<MaterialTicketRow | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const shortUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/t/${idRaw}`;
  }, [idRaw]);

  const sb: SupabaseClient | null = useMemo(() => {
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey);
  }, [supabaseUrl, supabaseKey]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setErr(null);
      setRow(null);
      setPhotoUrl(null);

      if (!idRaw || Number.isNaN(idNum)) {
        setLoading(false);
        setErr("ID inválido.");
        return;
      }

      if (!sb) {
        setLoading(false);
        setErr(
          "Faltam variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY no Vercel."
        );
        return;
      }

      const { data, error } = await sb
        .from("material_tickets")
        .select(
          "id,created_at,tipo,veiculo,origem,destino,material,data,horario,peso_t,arquivo_path,arquivo_nome,arquivo_mime,arquivo_size"
        )
        .eq("id", idNum)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setErr(error.message || "Erro ao buscar ticket.");
        setLoading(false);
        return;
      }

      if (!data) {
        setErr("Ticket não encontrado.");
        setLoading(false);
        return;
      }

      const typed = data as MaterialTicketRow;
      setRow(typed);

      // Foto: gera signed url (funciona mesmo se bucket for private)
      if (typed.arquivo_path) {
        const parts = typed.arquivo_path.split("/");
        const bucket = parts[0]; // "material"
        const objectPath = parts.slice(1).join("/"); // "2026-01-15/xxx.jpg"

        try {
          const { data: signed, error: e2 } = await sb.storage
            .from(bucket)
            .createSignedUrl(objectPath, 60 * 60 * 24 * 7);

          if (!cancelled && !e2 && signed?.signedUrl) {
            setPhotoUrl(signed.signedUrl);
          }
        } catch {
          // ignore
        }
      }

      setLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [idRaw, idNum, sb]);

  async function onCopy() {
    if (!row) return;
    const text = buildShareText(row, shortUrl);
    try {
      await navigator.clipboard.writeText(text);
      alert("Copiado!");
    } catch {
      alert("Não consegui copiar automaticamente. Copie manualmente.");
    }
  }

  function onWhatsApp() {
    if (!row) return;
    const text = buildShareText(row, shortUrl);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ fontSize: 28, marginBottom: 12 }}>Ticket</h1>

      {loading && <p>Carregando...</p>}

      {!loading && err && (
        <div style={{ border: "1px solid #f5a3a3", background: "#fff5f5", padding: 12, borderRadius: 10 }}>
          <strong>Erro</strong>
          <div>{err}</div>
        </div>
      )}

      {!loading && row && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><strong>ID:</strong> {row.id}</div>
              <div><strong>Tipo:</strong> {row.tipo || "-"}</div>
              <div><strong>Veículo:</strong> {row.veiculo || "-"}</div>
              <div><strong>Data:</strong> {row.data ? brDateFromISO(row.data) : "-"}</div>
              <div><strong>Horário:</strong> {row.horario || "-"}</div>
              <div><strong>Peso (t):</strong> {row.peso_t != null ? formatPeso(row.peso_t) : "-"}</div>
              <div style={{ gridColumn: "1 / -1" }}><strong>Origem:</strong> {row.origem || "-"}</div>
              <div style={{ gridColumn: "1 / -1" }}><strong>Destino:</strong> {row.destino || "-"}</div>
              <div style={{ gridColumn: "1 / -1" }}><strong>Material:</strong> {row.material || "-"}</div>
            </div>
          </div>

          {photoUrl && (
            <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>Foto</div>
              <img
                src={photoUrl}
                alt={row.arquivo_nome || "Foto do ticket"}
                style={{ width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 10, background: "#fafafa" }}
              />
            </div>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button onClick={onCopy} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>
              Copiar texto p/ WhatsApp
            </button>
            <button onClick={onWhatsApp} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}>
              Abrir WhatsApp
            </button>
            <span style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd" }}>
              Link curto: /t/{row.id}
            </span>
          </div>

          <div style={{ fontSize: 12, color: "#666" }}>
            Compartilhe só o <b>link curto</b> acima no WhatsApp — ele abre a foto e os detalhes (sem link gigante do Storage).
          </div>
        </div>
      )}
    </div>
  );
}

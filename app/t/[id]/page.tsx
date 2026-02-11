"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type TicketRow = {
  id: number;
  created_at: string;
  tipo: string | null;
  veiculo: string | null;
  origem: string | null;
  destino: string | null;
  material: string | null;
  data: string | null; // YYYY-MM-DD
  horario: string | null; // HH:mm:ss
  peso_t: number | null;
  arquivo_path: string | null;
  arquivo_nome: string | null;
  arquivo_mime: string | null;
  arquivo_size: number | null;
};

function formatDateBR(iso: string | null) {
  if (!iso) return "";
  // iso pode vir "2026-02-10"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, yyyy, mm, dd] = m;
  return `${dd}/${mm}/${yyyy.slice(-2)}`;
}

function fmtPeso(p: number | null) {
  if (p === null || !Number.isFinite(p)) return "";
  return Number(p).toFixed(3);
}

export default function TicketSharePage({ params }: { params: { id: string } }) {
  const ticketId = useMemo(() => {
    const n = Number(params?.id);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [params?.id]);

  // ✅ aceita ANON_KEY ou o publishable default que você já tem
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const SUPABASE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT ||
    "";

  const [origin, setOrigin] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");

  const shareUrl = useMemo(() => {
    if (!origin || !ticketId) return "";
    return `${origin}/t/${ticketId}`;
  }, [origin, ticketId]);

  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    let alive = true;

    async function run() {
      setErr("");
      setTicket(null);
      setImageUrl("");
      setLoading(true);

      try {
        if (!ticketId) throw new Error("ID inválido.");
        if (!SUPABASE_URL || !SUPABASE_KEY) {
          throw new Error(
            "Faltam variáveis NEXT_PUBLIC_SUPABASE_URL e/ou NEXT_PUBLIC_SUPABASE_ANON_KEY (ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT)."
          );
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        const { data, error } = await supabase
          .from("material_tickets")
          .select(
            "id,created_at,tipo,veiculo,origem,destino,material,data,horario,peso_t,arquivo_path,arquivo_nome,arquivo_mime,arquivo_size"
          )
          .eq("id", ticketId)
          .maybeSingle();

        if (error) throw new Error(error.message);
        if (!data) throw new Error("Ticket não encontrado.");

        if (!alive) return;
        setTicket(data as TicketRow);

        // tenta carregar imagem (não precisa ser “link curto” aqui, só exibir)
        if (data?.arquivo_path) {
          // 1) tenta publicUrl (se bucket for público)
          const pub = supabase.storage.from("tickets").getPublicUrl(data.arquivo_path);
          const publicUrl = pub?.data?.publicUrl || "";

          if (publicUrl) {
            setImageUrl(publicUrl);
          } else {
            // 2) fallback: signedUrl (se policy permitir)
            const signed = await supabase.storage
              .from("tickets")
              .createSignedUrl(data.arquivo_path, 60 * 60 * 24); // 24h
            if (signed?.data?.signedUrl) setImageUrl(signed.data.signedUrl);
          }
        }
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Erro inesperado.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [ticketId, SUPABASE_URL, SUPABASE_KEY]);

  const shareText = useMemo(() => {
    if (!ticket) return "";
    const dt = `${formatDateBR(ticket.data)} ${ticket.horario || ""}`.trim();

    return [
      `Ticket de ${ticket.tipo || ""}`.trim(),
      `ID: ${ticket.id}`,
      `Veículo: ${ticket.veiculo || ""}`.trim(),
      `Data/Hora: ${dt}`.trim(),
      `Origem: ${ticket.origem || ""}`.trim(),
      `Destino: ${ticket.destino || ""}`.trim(),
      `Material: ${ticket.material || ""}`.trim(),
      `Peso (t): ${fmtPeso(ticket.peso_t)}`.trim(),
      "",
      `Ver: ${shareUrl}`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [ticket, shareUrl]);

  async function handleShare() {
    if (!shareText) return;

    try {
      // share sheet (celular) — melhor pra “escolher grupo”
      // (não dá pra selecionar grupo automaticamente pelo WhatsApp)
      if (navigator.share) {
        await navigator.share({
          title: "Ticket",
          text: shareText,
          url: shareUrl || undefined,
        });
        return;
      }
    } catch {
      // cai pro fallback abaixo
    }

    const wa = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(wa, "_blank");
  }

  async function handleCopy() {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      alert("Copiado!");
    } catch {
      alert("Não consegui copiar automaticamente. Selecione e copie manualmente.");
    }
  }

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>Ticket</h1>

      {loading && <p>Carregando...</p>}

      {!loading && err && (
        <div style={{ padding: 12, border: "1px solid #fca5a5", borderRadius: 10 }}>
          <p style={{ margin: 0, fontWeight: 700 }}>Erro</p>
          <p style={{ margin: "6px 0 0 0" }}>{err}</p>
        </div>
      )}

      {!loading && ticket && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={handleShare}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Compartilhar (WhatsApp)
            </button>

            <button
              onClick={handleCopy}
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Copiar texto
            </button>
          </div>

          {imageUrl && (
            <div style={{ border: "1px solid #eee", borderRadius: 12, overflow: "hidden" }}>
              <img
                src={imageUrl}
                alt="Foto do ticket"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
          )}

          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div><b>ID:</b> {ticket.id}</div>
            <div><b>Tipo:</b> {ticket.tipo}</div>
            <div><b>Veículo:</b> {ticket.veiculo}</div>
            <div><b>Data/Hora:</b> {formatDateBR(ticket.data)} {ticket.horario}</div>
            <div><b>Origem:</b> {ticket.origem}</div>
            <div><b>Destino:</b> {ticket.destino}</div>
            <div><b>Material:</b> {ticket.material}</div>
            <div><b>Peso (t):</b> {fmtPeso(ticket.peso_t)}</div>
          </div>

          <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Texto que vai pro WhatsApp</div>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{shareText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

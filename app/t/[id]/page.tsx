"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type TicketTipo = "ENTRADA" | "SAIDA";

type TicketRow = {
  id: number;
  tipo: TicketTipo;
  veiculo: string | null;
  data: string | null; // date (YYYY-MM-DD)
  horario: string | null; // time (HH:MM:SS)
  origem: string | null;
  destino: string | null;
  material: string | null;
  peso_t: number | null;
  arquivo_path: string | null;
  created_at: string | null;
};

function fmtPeso(p: number | null) {
  if (p === null || !Number.isFinite(p)) return "-";
  return Number(p).toFixed(3);
}

function fmtDateBR(iso: string | null) {
  if (!iso) return "-";
  // espera YYYY-MM-DD
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

export default function TicketSharePage({ params }: { params: { id: string } }) {
  const idNum = useMemo(() => {
    const s = (params?.id || "").trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [params?.id]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<TicketRow | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);

  const shareUrl = useMemo(() => {
    if (!row) return null;
    return `${window.location.origin}/t/${row.id}`;
  }, [row]);

  const shareText = useMemo(() => {
    if (!row || !shareUrl) return null;

    const titulo = row.tipo === "SAIDA" ? "Ticket de SAÍDA" : "Ticket de ENTRADA";
    const dt = `${fmtDateBR(row.data)} ${row.horario || ""}`.trim();

    return [
      `✅ ${titulo}`,
      `ID: ${row.id}`,
      row.veiculo ? `Veículo: ${row.veiculo}` : null,
      dt !== "-" ? `Data/Hora: ${dt}` : null,
      row.origem ? `Origem: ${row.origem}` : null,
      row.destino ? `Destino: ${row.destino}` : null,
      row.material ? `Material: ${row.material}` : null,
      `Peso (t): ${fmtPeso(row.peso_t)}`,
      "",
      `Link: ${shareUrl}`,
    ]
      .filter(Boolean)
      .join("\n");
  }, [row, shareUrl]);

  async function load() {
    setErr(null);
    setSignedUrl(null);
    setRow(null);

    if (!idNum) {
      setErr("ID inválido.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("material_tickets")
        .select(
          "id,tipo,veiculo,data,horario,origem,destino,material,peso_t,arquivo_path,created_at"
        )
        .eq("id", idNum)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) {
        setErr("Ticket não encontrado.");
        return;
      }

      setRow(data as TicketRow);

      const path = (data as TicketRow).arquivo_path;
      if (path) {
        const { data: signed, error: errSigned } = await supabase.storage
          .from("tickets")
          .createSignedUrl(path, 60 * 60 * 24 * 30); // 30 dias

        if (!errSigned && signed?.signedUrl) {
          setSignedUrl(signed.signedUrl);
        }
      }
    } catch (e: any) {
      setErr(e?.message || "Falha ao carregar ticket.");
    } finally {
      setLoading(false);
    }
  }

  async function onShareWhatsapp() {
    if (!shareText) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function onNativeShare() {
    if (!shareText || !shareUrl) return;

    // se o browser suportar, abre o share nativo
    // (no iPhone/Android isso costuma funcionar bem)
    // senão cai no WhatsApp
    // @ts-ignore
    if (navigator?.share) {
      try {
        // @ts-ignore
        await navigator.share({
          title: "Ticket",
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {
        // ignora e cai no WhatsApp
      }
    }
    await onShareWhatsapp();
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNum]);

  return (
    <main style={{ padding: 16, maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>
        Ticket
      </h1>

      {loading && <p>Carregando...</p>}

      {!loading && err && (
        <p style={{ color: "#b00020", fontWeight: 600 }}>{err}</p>
      )}

      {!loading && row && (
        <div
          style={{
            border: "1px solid #eee",
            borderRadius: 12,
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <b>Tipo:</b> {row.tipo}
            </div>
            <div>
              <b>ID:</b> {row.id}
            </div>
            <div>
              <b>Veículo:</b> {row.veiculo || "-"}
            </div>
            <div>
              <b>Data:</b> {fmtDateBR(row.data)} &nbsp; <b>Hora:</b>{" "}
              {row.horario || "-"}
            </div>
            <div>
              <b>Origem:</b> {row.origem || "-"}
            </div>
            <div>
              <b>Destino:</b> {row.destino || "-"}
            </div>
            <div>
              <b>Material:</b> {row.material || "-"}
            </div>
            <div>
              <b>Peso (t):</b> {fmtPeso(row.peso_t)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={onNativeShare}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Compartilhar
            </button>

            <button
              onClick={onShareWhatsapp}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #25D366",
                background: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              WhatsApp
            </button>

            <button
              onClick={load}
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid #ddd",
                background: "white",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Recarregar
            </button>
          </div>

          {signedUrl ? (
            <div style={{ display: "grid", gap: 8 }}>
              <img
                src={signedUrl}
                alt={`Ticket ${row.id}`}
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid #eee",
                }}
              />
              <a
                href={signedUrl}
                target="_blank"
                rel="noreferrer"
                style={{ fontWeight: 700 }}
              >
                Abrir foto em nova aba
              </a>
            </div>
          ) : (
            <div style={{ color: "#666" }}>
              Foto: não disponível (sem arquivo_path ou não consegui gerar URL).
            </div>
          )}
        </div>
      )}
    </main>
  );
}

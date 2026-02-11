"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type TicketRow = {
  id: number;
  tipo: "ENTRADA" | "SAIDA" | string | null;
  veiculo: string | null;
  origem: string | null;
  destino: string | null;
  material: string | null;
  data: string | null; // yyyy-mm-dd (supabase date)
  horario: string | null; // hh:mm:ss (supabase time)
  peso_t: number | null;
  arquivo_path: string | null;
  created_at?: string | null;
};

function supabasePublic() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function ymdToBrShort(ymd: string | null) {
  if (!ymd) return null;
  // aceita "2026-01-16" ou "2026-01-16T00:00:00Z"
  const d = ymd.slice(0, 10);
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const yy = m[1].slice(-2);
  return `${m[3]}/${m[2]}/${yy}`;
}

function fmtPeso(n: number | null) {
  if (n === null || !Number.isFinite(n)) return null;
  return Number(n).toFixed(3);
}

function safe(s: any) {
  const v = (s ?? "").toString().trim();
  return v || null;
}

export default function Page({ params }: { params: { id: string } }) {
  const idNum = Number(params?.id);
  const supabase = useMemo(() => supabasePublic(), []);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<TicketRow | null>(null);

  const [copied, setCopied] = useState<string | null>(null);

  const pageUrl =
    typeof window !== "undefined" ? window.location.origin + `/t/${idNum}` : "";

  const photoUrl = useMemo(() => {
    if (!supabase || !row?.arquivo_path) return null;
    // bucket "tickets"
    const { data } = supabase.storage.from("tickets").getPublicUrl(row.arquivo_path);
    return data?.publicUrl || null;
  }, [supabase, row?.arquivo_path]);

  const shareText = useMemo(() => {
    if (!row) return "";
    const tipo = (row.tipo || "SAIDA").toString().toUpperCase();
    const dataBr = ymdToBrShort(row.data) || "";
    const hora = safe(row.horario) || "";
    const dt = [dataBr, hora].filter(Boolean).join(" ");

    const peso = fmtPeso(row.peso_t);
    const parts = [
      `✅ Ticket de ${tipo}`,
      `ID: ${row.id}`,
      row.veiculo ? `Veículo: ${row.veiculo}` : null,
      dt ? `Data/Hora: ${dt}` : null,
      row.origem ? `Origem: ${row.origem}` : null,
      row.destino ? `Destino: ${row.destino}` : null,
      row.material ? `Material: ${row.material}` : null,
      peso ? `Peso (t): ${peso}` : null,
      pageUrl ? `Link: ${pageUrl}` : null, // ✅ link curto do ticket
    ].filter(Boolean) as string[];

    return parts.join("\n");
  }, [row, pageUrl]);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      // fallback simples
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(label);
        setTimeout(() => setCopied(null), 1200);
      } catch {
        setCopied("Falhou");
        setTimeout(() => setCopied(null), 1200);
      }
    }
  }

  async function shareWhatsapp() {
    if (!row) return;

    // Preferir Web Share (abre sheet no celular -> escolhe WhatsApp/grupo)
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Ticket ${row.id}`,
          text: shareText,
          url: pageUrl || undefined,
        });
        return;
      }
    } catch {
      // cai pro fallback
    }

    // Fallback universal: wa.me com texto
    const url = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setErr(null);

      if (!supabase) {
        setErr("Faltam variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
        setLoading(false);
        return;
      }
      if (!Number.isFinite(idNum) || idNum <= 0) {
        setErr("ID inválido.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("material_tickets")
        .select(
          "id,tipo,veiculo,origem,destino,material,data,horario,peso_t,arquivo_path,created_at"
        )
        .eq("id", idNum)
        .single();

      if (!alive) return;

      if (error) {
        setErr(error.message || "Falha ao carregar ticket.");
        setRow(null);
        setLoading(false);
        return;
      }

      setRow(data as TicketRow);
      setLoading(false);
    }

    run();
    return () => {
      alive = false;
    };
  }, [supabase, idNum]);

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white">
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Ticket</div>
            <div className="text-xs text-white/60">Compartilhamento (link curto)</div>
          </div>

          {row?.tipo ? (
            <span className="rounded-full bg-white/10 px-3 py-1 text-xs">
              {row.tipo.toUpperCase()}
            </span>
          ) : null}
        </div>

        <div className="rounded-2xl bg-white/5 p-4 shadow-sm ring-1 ring-white/10">
          {loading ? (
            <div className="text-sm text-white/70">Carregando…</div>
          ) : err ? (
            <div className="text-sm text-red-300">{err}</div>
          ) : !row ? (
            <div className="text-sm text-white/70">Não encontrado.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-white/60">ID</div>
                    <div className="font-medium">{row.id}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">Veículo</div>
                    <div className="font-medium">{row.veiculo || "-"}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-white/60">Data</div>
                    <div className="font-medium">{ymdToBrShort(row.data) || "-"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-white/60">Horário</div>
                    <div className="font-medium">{row.horario || "-"}</div>
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-white/60">Origem</div>
                  <div className="font-medium">{row.origem || "-"}</div>
                </div>

                <div>
                  <div className="text-[11px] text-white/60">Destino</div>
                  <div className="font-medium">{row.destino || "-"}</div>
                </div>

                <div>
                  <div className="text-[11px] text-white/60">Material</div>
                  <div className="font-medium">{row.material || "-"}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] text-white/60">Peso (t)</div>
                    <div className="font-medium">{fmtPeso(row.peso_t) || "-"}</div>
                  </div>

                  <div>
                    <div className="text-[11px] text-white/60">Link</div>
                    <div className="truncate text-sm text-white/80">{pageUrl}</div>
                  </div>
                </div>
              </div>

              {photoUrl ? (
                <div className="mt-4">
                  <div className="mb-2 text-[11px] text-white/60">Foto</div>
                  <a
                    href={photoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block overflow-hidden rounded-xl ring-1 ring-white/10"
                    title="Abrir foto"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt={`Ticket ${row.id}`}
                      className="h-auto w-full"
                      loading="lazy"
                    />
                  </a>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => copyText("Link da foto", photoUrl)}
                      className="rounded-xl bg-white/10 px-3 py-2 text-xs hover:bg-white/15"
                    >
                      Copiar link da foto
                    </button>
                    <a
                      href={photoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-white/10 px-3 py-2 text-xs hover:bg-white/15"
                    >
                      Abrir
                    </a>
                  </div>
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  onClick={shareWhatsapp}
                  className="rounded-2xl bg-gradient-to-r from-red-500 to-orange-500 px-4 py-3 text-sm font-semibold shadow-sm"
                >
                  Compartilhar no WhatsApp
                </button>

                <button
                  onClick={() => copyText("Mensagem", shareText)}
                  className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15"
                >
                  Copiar mensagem
                </button>

                <button
                  onClick={() => copyText("Link do ticket", pageUrl)}
                  className="rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold hover:bg-white/15"
                >
                  Copiar link curto
                </button>

                {copied ? (
                  <div className="flex items-center justify-center rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/80">
                    {copied === "Falhou" ? "Falhou ao copiar" : `${copied} copiado ✅`}
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-2xl bg-white/5 px-4 py-3 text-sm text-white/50">
                    Dica: no celular use “Compartilhar”
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

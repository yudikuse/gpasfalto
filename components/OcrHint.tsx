"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

type Kind = "horimetro" | "odometro" | "abastecimento" | "equipamento";

type OcrResp = {
  ok: boolean;
  kind?: Kind;
  best?: number | null;
  best_input?: string | null;
  candidates?: number[];
  candidates_input?: string[];
  raw?: string;
  error?: string;
};

export default function OcrHint(props: {
  kind: Kind;
  imageUrl: string | null;
  currentValue?: string;
  autoApplyIfEmpty?: boolean;
  onApply?: (v: string) => void;
}) {
  const {
    kind,
    imageUrl,
    currentValue = "",
    autoApplyIfEmpty = false,
    onApply,
  } = props;

  const [loading, setLoading] = useState(false);
  const [best, setBest] = useState<string | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lastUrlRef = useRef<string | null>(null);
  const appliedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const url = imageUrl || null;

    setErr(null);
    setBest(null);
    setRaw(null);

    if (!url || url.length < 10) return;

    // evita reprocessar a mesma URL
    if (lastUrlRef.current === url) return;
    lastUrlRef.current = url;

    const ctrl = new AbortController();

    async function run() {
      try {
        setLoading(true);

        const res = await fetch(
          `/api/vision/ocr?kind=${encodeURIComponent(
            kind
          )}&url=${encodeURIComponent(url)}`,
          { signal: ctrl.signal, cache: "no-store" }
        );

        const data = (await res.json()) as OcrResp;
        if (!alive) return;

        if (!res.ok || !data?.ok) {
          setErr(data?.error || `OCR falhou (${res.status})`);
          return;
        }

        const bi = (data.best_input ?? "").toString().trim();
        setBest(bi || null);
        setRaw(data.raw || null);

        // auto-preencher 1x por URL (somente se vazio)
        if (autoApplyIfEmpty && onApply && !currentValue.trim() && bi) {
          if (appliedUrlRef.current !== url) {
            appliedUrlRef.current = url;
            onApply(bi);
          }
        }
      } catch (e: any) {
        if (!alive) return;
        if (e?.name === "AbortError") return;
        setErr(e?.message || "Erro ao chamar OCR");
      } finally {
        if (alive) setLoading(false);
      }
    }

    const t = setTimeout(run, 250);

    return () => {
      alive = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [kind, imageUrl, autoApplyIfEmpty, currentValue, onApply]);

  if (!imageUrl) return null;

  const row: CSSProperties = {
    marginTop: 8,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    color: "var(--gp-muted-soft)",
  };

  const btn: CSSProperties = {
    marginLeft: "auto",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "var(--gp-text)",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: 12,
  };

  const detailsBox: CSSProperties = {
    marginTop: 8,
    fontSize: 12,
    color: "var(--gp-muted-soft)",
  };

  const preBox: CSSProperties = {
    marginTop: 8,
    whiteSpace: "pre-wrap",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    padding: 10,
    color: "var(--gp-text)",
  };

  if (loading) return <div style={row}>Lendo foto…</div>;
  if (err) return <div style={{ ...row, color: "#b91c1c" }}>OCR: {err}</div>;
  if (!best) return null;

  return (
    <div>
      <div style={row}>
        Sugestão da foto: <b style={{ color: "var(--gp-text)" }}>{best}</b>
        {onApply ? (
          <button type="button" style={btn} onClick={() => onApply(best)}>
            Aplicar
          </button>
        ) : null}
      </div>

      {raw ? (
        <details style={detailsBox}>
          <summary style={{ cursor: "pointer" }}>Ver texto lido</summary>
          <div style={preBox}>{raw}</div>
        </details>
      ) : null}
    </div>
  );
}

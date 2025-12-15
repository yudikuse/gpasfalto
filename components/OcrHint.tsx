"use client";

import { useEffect, useRef, useState } from "react";

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
  const { kind, imageUrl, currentValue = "", autoApplyIfEmpty = false, onApply } = props;

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

    // evita reprocessar a mesma URL toda hora
    if (lastUrlRef.current === url) return;
    lastUrlRef.current = url;

    const ctrl = new AbortController();

    async function run() {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/vision/ocr?kind=${encodeURIComponent(kind)}&url=${encodeURIComponent(url)}`,
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

        // auto-preencher (somente se vazio e só 1x por URL)
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

    // debounce leve (evita martelar quando a URL muda rápido)
    const t = setTimeout(run, 350);

    return () => {
      alive = false;
      clearTimeout(t);
      ctrl.abort();
    };
  }, [kind, imageUrl, autoApplyIfEmpty, currentValue, onApply]);

  if (!imageUrl) return null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      {loading && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-slate-600" />
          Lendo foto…
        </div>
      )}

      {!loading && err && (
        <div className="text-xs text-red-600">OCR: {err}</div>
      )}

      {!loading && !err && best && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-600">
            Sugestão da foto: <b className="text-slate-900">{best}</b>
          </span>

          {onApply && (
            <button
              type="button"
              onClick={() => onApply(best)}
              className="ml-auto rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              Aplicar
            </button>
          )}
        </div>
      )}

      {!loading && !err && raw && (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer select-none">Ver texto lido</summary>
          <div className="mt-1 whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-600">
            {raw}
          </div>
        </details>
      )}
    </div>
  );
}

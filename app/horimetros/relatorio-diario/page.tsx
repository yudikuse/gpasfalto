// FILE: app/horimetros/relatorio-diario/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

type ObraRow  = { id: number; obra: string };
type EquipRow = { id: number; codigo: string };

type LeituraRow = {
  id: number;
  equipamento_id: number;
  obra_id: number | null;
  horimetro_inicial: number | null;
  horimetro_final: number | null;
  horas_trabalhadas: number | null;
  odometro_inicial: number | null;
  odometro_final: number | null;
  km_rodados: number | null;
  observacao: string | null;
  producao: string | null;
};

type ProducaoObraRow = {
  id: number;
  data: string;
  obra_id: number;
  descricao: string;
  quantidade: number | null;
  unidade: string;
};

// state local para edição da produção por equipamento
type EquipEdit = {
  leituraId: number;
  equipId: number;
  codigo: string;
  horIni: number | null;
  horFin: number | null;
  horasDia: number | null;
  odoIni: number | null;
  odoFin: number | null;
  kmDia: number | null;
  observacao: string;
  producao: string;
  dirty: boolean;
};

type ProducaoEdit = {
  id: number | null; // null = novo
  descricao: string;
  quantidade: string;
  unidade: string;
  dirty: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isoToBr(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function fmt1(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function isoShift(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const UNIDADES = ["m²", "m³", "ton", "km", "ml", "un", "viagens", "h"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function RelatorioDiarioPage() {
  const today = isoToday();

  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedObraId, setSelectedObraId] = useState<string>("");
  const [obras, setObras]   = useState<ObraRow[]>([]);
  const [equips, setEquips] = useState<EquipRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied]     = useState(false);

  const [equipEdits, setEquipEdits] = useState<EquipEdit[]>([]);
  const [prodObra, setProdObra]     = useState<ProducaoEdit[]>([]);

  // ─── Load obras + equips (uma vez) ──────────────────────────────────────

  useEffect(() => {
    supabase.from("obras").select("id,obra").eq("ativo", true).order("obra").limit(500)
      .then(r => setObras((r.data ?? []) as ObraRow[]));
    supabase.from("horimetro_equipamentos").select("id,codigo").eq("ativo", true).order("codigo").limit(500)
      .then(r => setEquips((r.data ?? []) as EquipRow[]));
  }, []);

  // ─── Load leituras do dia + obra ────────────────────────────────────────

  const loadDia = useCallback(async () => {
    if (!selectedObraId) return;
    setLoading(true);
    setMsg(null);

    const [leiturasRes, prodRes] = await Promise.all([
      supabase
        .from("horimetro_leituras_diarias")
        .select("id,equipamento_id,obra_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,producao")
        .eq("data", selectedDate)
        .eq("obra_id", selectedObraId),
      supabase
        .from("horimetro_producao_obra")
        .select("id,data,obra_id,descricao,quantidade,unidade")
        .eq("data", selectedDate)
        .eq("obra_id", selectedObraId),
    ]);

    const leituras = (leiturasRes.data ?? []) as LeituraRow[];
    const prods    = (prodRes.data    ?? []) as ProducaoObraRow[];

    const equipMap = new Map(equips.map(e => [e.id, e.codigo]));

    setEquipEdits(
      leituras.map(l => ({
        leituraId:   l.id,
        equipId:     l.equipamento_id,
        codigo:      equipMap.get(l.equipamento_id) ?? String(l.equipamento_id),
        horIni:      l.horimetro_inicial,
        horFin:      l.horimetro_final,
        horasDia:    l.horas_trabalhadas,
        odoIni:      l.odometro_inicial,
        odoFin:      l.odometro_final,
        kmDia:       l.km_rodados,
        observacao:  l.observacao ?? "",
        producao:    l.producao   ?? "",
        dirty:       false,
      }))
    );

    setProdObra(
      prods.length > 0
        ? prods.map(p => ({
            id:          p.id,
            descricao:   p.descricao,
            quantidade:  String(p.quantidade ?? ""),
            unidade:     p.unidade,
            dirty:       false,
          }))
        : [{ id: null, descricao: "", quantidade: "", unidade: "m²", dirty: false }]
    );

    setLoading(false);
  }, [selectedDate, selectedObraId, equips]);

  useEffect(() => { void loadDia(); }, [loadDia]);

  // ─── Editar produção por equipamento ────────────────────────────────────

  function updateEquip(leituraId: number, field: "producao" | "observacao", value: string) {
    setEquipEdits(prev =>
      prev.map(e => e.leituraId === leituraId ? { ...e, [field]: value, dirty: true } : e)
    );
  }

  // ─── Editar produção por obra ────────────────────────────────────────────

  function updateProd(idx: number, field: keyof ProducaoEdit, value: string) {
    setProdObra(prev =>
      prev.map((p, i) => i === idx ? { ...p, [field]: value, dirty: true } : p)
    );
  }

  function addProdRow() {
    setProdObra(prev => [...prev, { id: null, descricao: "", quantidade: "", unidade: "m²", dirty: true }]);
  }

  function removeProdRow(idx: number) {
    setProdObra(prev => prev.filter((_, i) => i !== idx));
  }

  // ─── Salvar ──────────────────────────────────────────────────────────────

  async function salvar() {
    setSaving(true);
    setMsg(null);
    try {
      // 1. Atualiza producao em leituras sujas
      const dirtyEquips = equipEdits.filter(e => e.dirty);
      for (const e of dirtyEquips) {
        const { error } = await supabase
          .from("horimetro_leituras_diarias")
          .update({ producao: e.producao || null })
          .eq("id", e.leituraId);
        if (error) throw error;
      }

      // 2. Upsert produções por obra
      for (const p of prodObra) {
        if (!p.dirty) continue;
        if (!p.descricao.trim()) continue;
        const payload = {
          data:       selectedDate,
          obra_id:    Number(selectedObraId),
          descricao:  p.descricao.trim(),
          quantidade: p.quantidade ? Number(p.quantidade.replace(",", ".")) : null,
          unidade:    p.unidade,
        };
        if (p.id) {
          const { error } = await supabase.from("horimetro_producao_obra").update(payload).eq("id", p.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("horimetro_producao_obra").insert(payload);
          if (error) throw error;
        }
      }

      // Marca tudo como salvo
      setEquipEdits(prev => prev.map(e => ({ ...e, dirty: false })));
      setProdObra(prev => prev.map(p => ({ ...p, dirty: false })));
      setMsg({ type: "ok", text: "Salvo com sucesso." });
      await loadDia();
    } catch (err: any) {
      setMsg({ type: "err", text: err?.message ?? "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  // ─── Gerar texto WhatsApp ─────────────────────────────────────────────────

  const obraNome = useMemo(
    () => obras.find(o => String(o.id) === selectedObraId)?.obra ?? "",
    [obras, selectedObraId]
  );

  const textoWpp = useMemo(() => {
    if (!selectedObraId || equipEdits.length === 0) return "";
    const dataBr = isoToBr(selectedDate);

    const lines: string[] = [];
    lines.push(`*${obraNome} · ${dataBr}*`);
    lines.push("");

    // Produções por obra
    const prodsValidas = prodObra.filter(p => p.descricao.trim());
    if (prodsValidas.length > 0) {
      prodsValidas.forEach(p => {
        const qtd = p.quantidade ? ` ${p.quantidade}${p.unidade}` : "";
        lines.push(p.descricao.trim() + qtd);
      });
      lines.push("");
    }

    // Separar equipamentos de horímetro e odômetro
    const horEquips = equipEdits.filter(e => e.horFin != null || e.horIni != null);
    const odoEquips = equipEdits.filter(e => e.odoFin != null || e.odoIni != null);
    const outrosEquips = equipEdits.filter(
      e => e.horFin == null && e.horIni == null && e.odoFin == null && e.odoIni == null
    );

    if (horEquips.length > 0) {
      lines.push("*Equipamentos Horímetro*");
      horEquips.forEach(e => {
        let line = `${e.codigo} = ${fmt1(e.horIni)}/${fmt1(e.horFin)} = ${fmt1(e.horasDia)} horas`;
        if (e.producao) line += ` - ${e.producao}`;
        if (e.observacao && !e.observacao.startsWith("[TROCA]")) line += ` (${e.observacao})`;
        lines.push(line);
      });
      lines.push("");
    }

    if (odoEquips.length > 0) {
      lines.push("*Caminhões Odômetro*");
      odoEquips.forEach(e => {
        let line = `${e.codigo} = ${fmt1(e.odoIni)}/${fmt1(e.odoFin)} = ${fmt1(e.kmDia)} km`;
        if (e.producao) line += ` - ${e.producao}`;
        lines.push(line);
      });
      lines.push("");
    }

    if (outrosEquips.length > 0) {
      lines.push("*Outros*");
      outrosEquips.forEach(e => {
        let line = e.codigo;
        if (e.producao) line += ` - ${e.producao}`;
        lines.push(line);
      });
    }

    return lines.join("\n").trim();
  }, [equipEdits, prodObra, selectedObraId, selectedDate, obraNome]);

  async function copiarWpp() {
    await navigator.clipboard.writeText(textoWpp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // ─── Exportar CSV ────────────────────────────────────────────────────────

  function exportarCSV() {
    const rows: string[][] = [];
    rows.push(["Data", "Obra", "Equipamento", "Hor Ini", "Hor Fin", "Horas", "Odo Ini", "Odo Fin", "Km", "Produção", "Observação"]);
    for (const e of equipEdits) {
      rows.push([
        isoToBr(selectedDate),
        obraNome,
        e.codigo,
        String(e.horIni ?? ""),
        String(e.horFin ?? ""),
        String(e.horasDia ?? ""),
        String(e.odoIni ?? ""),
        String(e.odoFin ?? ""),
        String(e.kmDia ?? ""),
        e.producao,
        e.observacao,
      ]);
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${selectedDate}-${obraNome.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasDirty = equipEdits.some(e => e.dirty) || prodObra.some(p => p.dirty);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="page-root">
      <style>{`
        .rd-nav-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid #e5e7eb;background:#fff;cursor:pointer;font-size:14px;color:var(--gp-muted);transition:.15s;}
        .rd-nav-btn:hover{background:var(--gp-accent-soft);border-color:rgba(255,75,43,.3);color:var(--gp-accent);}
        .rd-equip-row{display:grid;grid-template-columns:80px 1fr 1fr 200px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;}
        .rd-equip-row:last-child{border-bottom:none;}
        .rd-equip-code{font-weight:700;font-size:.85rem;}
        .rd-equip-vals{font-size:.8rem;color:var(--gp-muted);}
        .rd-equip-vals span{font-weight:600;color:var(--gp-text);}
        .rd-prod-input{height:32px;border-radius:8px;border:1px solid #e5e7eb;padding:0 8px;font-size:.82rem;width:100%;outline:none;background:#fff;}
        .rd-prod-input:focus{border-color:rgba(255,75,43,.5);box-shadow:0 0 0 3px rgba(255,75,43,.08);}
        .rd-prod-input.dirty{border-color:rgba(255,75,43,.4);background:#fffaf9;}
        .rd-obra-row{display:grid;grid-template-columns:1fr 90px 100px 32px;gap:6px;align-items:center;margin-bottom:6px;}
        .rd-wpp-box{font-family:monospace;font-size:.82rem;line-height:1.6;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;white-space:pre-wrap;color:var(--gp-text);max-height:380px;overflow-y:auto;}
        .rd-badge-dirty{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--gp-accent);margin-left:4px;vertical-align:middle;}
        @media(max-width:600px){.rd-equip-row{grid-template-columns:70px 1fr;}.rd-equip-vals{display:none;}}
      `}</style>

      <div className="page-container">

        {/* ── Header ── */}
        <header className="page-header">
          <div className="brand">
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="brand-logo" />
            <div>
              <div className="brand-text-main">Relatório Diário</div>
              <div className="brand-text-sub">Produção por obra e equipamento · geração automática</div>
            </div>
          </div>
          <a href="/horimetros" style={{ fontSize: ".8rem", color: "var(--gp-muted)", textDecoration: "none" }}>
            ← Horímetros
          </a>
        </header>

        {/* ── Filtros ── */}
        <section className="section-card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>

            {/* Navegação de data */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="rd-nav-btn" onClick={() => setSelectedDate(d => isoShift(d, -1))}>‹</button>
              <input
                type="date"
                className="gp-input"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
              />
              <button className="rd-nav-btn" onClick={() => setSelectedDate(d => isoShift(d, 1))}>›</button>
              <button
                className="gp-btn gp-btn-ghost"
                style={{ fontSize: ".75rem", padding: "4px 10px", height: 28 }}
                onClick={() => setSelectedDate(today)}
              >
                Hoje
              </button>
            </div>

            {/* Obra */}
            <select
              className="gp-select"
              style={{ minWidth: 220 }}
              value={selectedObraId}
              onChange={e => setSelectedObraId(e.target.value)}
            >
              <option value="">Selecione a obra…</option>
              {obras.map(o => <option key={o.id} value={String(o.id)}>{o.obra}</option>)}
            </select>

            {loading && <span style={{ fontSize: ".78rem", color: "var(--gp-muted-soft)" }}>Carregando…</span>}
          </div>
        </section>

        {/* ── Sem obra selecionada ── */}
        {!selectedObraId && (
          <div className="state-card">Selecione uma obra para ver os lançamentos do dia.</div>
        )}

        {/* ── Sem leituras ── */}
        {selectedObraId && !loading && equipEdits.length === 0 && (
          <div className="state-card">
            Nenhum equipamento registrado em <strong>{obraNome}</strong> no dia {isoToBr(selectedDate)}.<br />
            <span style={{ fontSize: ".8rem" }}>Os lançamentos aparecem aqui após serem salvos na página de Horímetros.</span>
          </div>
        )}

        {/* ── Equipamentos ── */}
        {selectedObraId && equipEdits.length > 0 && (
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">
                  Equipamentos · {obraNome} · {isoToBr(selectedDate)}
                  {hasDirty && <span className="rd-badge-dirty" title="Há alterações não salvas" />}
                </div>
                <div className="section-subtitle">
                  Adicione a produção de cada equipamento no campo à direita (ex: 380m², 5 viagens)
                </div>
              </div>
            </div>

            <div>
              {/* Header */}
              <div className="rd-equip-row" style={{ borderBottom: "2px solid #e5e7eb", paddingBottom: 6 }}>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Equip.</div>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Horímetro / Odômetro</div>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Resultado</div>
                <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: ".06em" }}>Produção do dia</div>
              </div>

              {equipEdits.map(e => {
                const temHor = e.horFin != null || e.horIni != null;
                const temOdo = e.odoFin != null || e.odoIni != null;
                return (
                  <div key={e.leituraId} className="rd-equip-row">
                    <div className="rd-equip-code">{e.codigo}</div>

                    <div className="rd-equip-vals">
                      {temHor && <div>HOR <span>{fmt1(e.horIni)} → {fmt1(e.horFin)}</span></div>}
                      {temOdo && <div>ODO <span>{fmt1(e.odoIni)} → {fmt1(e.odoFin)}</span></div>}
                      {!temHor && !temOdo && <div style={{ color: "var(--gp-muted-soft)" }}>—</div>}
                    </div>

                    <div className="rd-equip-vals">
                      {temHor && <div><span>{fmt1(e.horasDia)} h</span></div>}
                      {temOdo && <div><span>{fmt1(e.kmDia)} km</span></div>}
                    </div>

                    <input
                      className={`rd-prod-input${e.dirty ? " dirty" : ""}`}
                      placeholder="ex: 380m², 5 viagens"
                      value={e.producao}
                      onChange={ev => updateEquip(e.leituraId, "producao", ev.target.value)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Produção por obra ── */}
        {selectedObraId && equipEdits.length > 0 && (
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Produção da obra no dia</div>
                <div className="section-subtitle">Descrição do serviço + quantidade total executada</div>
              </div>
            </div>

            {prodObra.map((p, idx) => (
              <div key={idx} className="rd-obra-row">
                <input
                  className={`rd-prod-input${p.dirty ? " dirty" : ""}`}
                  placeholder="Descrição (ex: Compactação subleito)"
                  value={p.descricao}
                  onChange={e => updateProd(idx, "descricao", e.target.value)}
                />
                <input
                  className={`rd-prod-input${p.dirty ? " dirty" : ""}`}
                  placeholder="Qtd"
                  value={p.quantidade}
                  onChange={e => updateProd(idx, "quantidade", e.target.value)}
                  inputMode="decimal"
                />
                <select
                  className="gp-select"
                  value={p.unidade}
                  onChange={e => updateProd(idx, "unidade", e.target.value)}
                  style={{ height: 32, fontSize: ".82rem" }}
                >
                  {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <button
                  className="gp-btn gp-btn-danger"
                  style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => removeProdRow(idx)}
                  title="Remover linha"
                >
                  ×
                </button>
              </div>
            ))}

            <button className="gp-btn gp-btn-ghost" style={{ fontSize: ".8rem", marginTop: 4 }} onClick={addProdRow}>
              + Adicionar serviço
            </button>
          </section>
        )}

        {/* ── Ações ── */}
        {selectedObraId && equipEdits.length > 0 && (
          <div className="gp-actions">
            <button
              className="gp-btn gp-btn-primary"
              onClick={salvar}
              disabled={saving || !hasDirty}
            >
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
            <button className="gp-btn" onClick={copiarWpp} disabled={!textoWpp}>
              {copied ? "✓ Copiado!" : "Copiar para WhatsApp"}
            </button>
            <button className="gp-btn gp-btn-ghost" onClick={exportarCSV}>
              Exportar CSV
            </button>
          </div>
        )}

        {/* ── Mensagem feedback ── */}
        {msg && (
          <div className="state-card" style={{ color: msg.type === "ok" ? "#16a34a" : "#dc2626" }}>
            {msg.text}
          </div>
        )}

        {/* ── Preview WhatsApp ── */}
        {textoWpp && (
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Preview · texto para WhatsApp</div>
                <div className="section-subtitle">Clique em "Copiar" acima e cole no grupo</div>
              </div>
            </div>
            <div className="rd-wpp-box">{textoWpp}</div>
          </section>
        )}

      </div>
    </div>
  );
}

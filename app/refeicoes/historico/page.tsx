"use client";

// ─────────────────────────────────────────────────────────────
// PASSO 4 — Tela de histórico / relatório
// Rota sugerida: /refeicoes/historico
//
// Funcionalidades:
//  • Login E-mail + PIN (mesmo padrão das outras páginas)
//  • Acesso liberado para encarregados E restaurantes
//  • Filtros: obra, período (de/até), turno
//  • Tabela: data, obra, turno, qtd, status, confirmado em
//  • Totalizador por turno no rodapé
//  • Exportar CSV
// ─────────────────────────────────────────────────────────────

import { useEffect, useState, useMemo, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

type HistoryRow = {
  orderId: string;
  mealDate: string;          // YYYY-MM-DD
  worksiteName: string;
  shift: Shift;
  qty: number;
  status: string | null;
  confirmedAt: string | null;
  createdBy: string | null;  // user_id do encarregado
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function iso30DaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function shiftLabel(s: Shift) {
  return s === "ALMOCO" ? "Almoço" : "Janta";
}

function statusLabel(s: string | null, confirmedAt: string | null) {
  if (confirmedAt) return "✅ Confirmado";
  if (s === "DRAFT" || !s) return "📝 Rascunho";
  return s;
}

// Gera CSV e dispara download no browser
function downloadCSV(rows: HistoryRow[]) {
  const header = ["Data", "Obra", "Turno", "Qtd", "Status", "Confirmado em"];
  const lines = rows.map((r) => [
    formatBR(r.mealDate),
    r.worksiteName,
    shiftLabel(r.shift),
    r.qty,
    r.confirmedAt ? "Confirmado" : (r.status ?? "Rascunho"),
    formatDateTime(r.confirmedAt),
  ]);

  const csv = [header, ...lines]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `refeicoes_${isoTodayLocal()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function HistoricoPage() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  // Filtros
  const [dateFrom, setDateFrom] = useState(iso30DaysAgo());
  const [dateTo, setDateTo] = useState(isoTodayLocal());
  const [filterShift, setFilterShift] = useState<Shift | "TODOS">("TODOS");
  const [filterWorksite, setFilterWorksite] = useState<string>("TODOS");

  // Dados
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [worksiteOptions, setWorksiteOptions] = useState<{ id: string; label: string }[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const styles: Record<string, CSSProperties> = {
    label: { fontSize: 12, fontWeight: 800, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 },
    input: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
    select: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
  };

  // ─── Auth ───────────────────────────────────────────────────
  async function doLogin() {
    setError(null);
    setOkMsg(null);
    const email = loginEmail.trim().toLowerCase();
    const pin = loginPin.trim();
    if (!email) return setError("Informe o e-mail."), undefined;
    if (!pin) return setError("Informe o PIN."), undefined;
    setLoggingIn(true);
    try {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (e) throw e;
    } catch (e: any) {
      setError(e?.message || "Falha no login.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUserId(null);
    setUserEmail("");
    router.replace("/refeicoes/historico");
  }

  async function loadUser() {
    await supabase.auth.getSession();
    const { data } = await supabase.auth.getUser();
    const u = data?.user ?? null;
    setUserEmail(u?.email || "");
    setUserId(u?.id || null);
    return u?.id || null;
  }

  useEffect(() => {
    loadUser();
    const { data } = supabase.auth.onAuthStateChange(() => { loadUser(); });
    return () => { data.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Busca principal ────────────────────────────────────────
  async function fetchHistory() {
    setError(null);
    setOkMsg(null);
    if (!userId) return;

    setLoading(true);
    try {
      // 1. Busca pedidos no período
      let query = supabase
        .from("meal_orders")
        .select("id, worksite_id, meal_date, shift, status, confirmed_at, created_by")
        .gte("meal_date", dateFrom)
        .lte("meal_date", dateTo)
        .order("meal_date", { ascending: false })
        .order("shift", { ascending: true });

      if (filterShift !== "TODOS") query = query.eq("shift", filterShift);

      const { data: orders, error: oErr } = await query;
      if (oErr) throw oErr;
      if (!orders || orders.length === 0) { setRows([]); return; }

      // 2. Busca obras
      const worksiteIds = Array.from(new Set(orders.map((o: any) => String(o.worksite_id))));
      const { data: ws, error: wErr } = await supabase
        .from("meal_worksites")
        .select("id, name, city")
        .in("id", worksiteIds);
      if (wErr) throw wErr;

      const wsMap = new Map<string, string>();
      (ws || []).forEach((w: any) => {
        wsMap.set(String(w.id), `${w.name}${w.city ? ` - ${w.city}` : ""}`);
      });

      // 3. Conta linhas por pedido
      const orderIds = orders.map((o: any) => String(o.id));
      const { data: lines, error: lErr } = await supabase
        .from("meal_order_lines")
        .select("meal_order_id")
        .in("meal_order_id", orderIds)
        .eq("included", true);
      if (lErr) throw lErr;

      const countMap = new Map<string, number>();
      (lines || []).forEach((l: any) => {
        const oid = String(l.meal_order_id);
        countMap.set(oid, (countMap.get(oid) || 0) + 1);
      });

      // 4. Monta as linhas
      const result: HistoryRow[] = orders.map((o: any) => ({
        orderId: String(o.id),
        mealDate: String(o.meal_date),
        worksiteName: wsMap.get(String(o.worksite_id)) || String(o.worksite_id),
        shift: o.shift as Shift,
        qty: countMap.get(String(o.id)) || 0,
        status: o.status ? String(o.status) : null,
        confirmedAt: o.confirmed_at ? String(o.confirmed_at) : null,
        createdBy: o.created_by ? String(o.created_by) : null,
      }));

      // Atualiza opções de filtro por obra
      const uniqueWs = Array.from(new Map(result.map((r) => [r.worksiteName, r.worksiteName])).entries()).map(([id, label]) => ({ id, label }));
      setWorksiteOptions(uniqueWs);

      setRows(result);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar histórico.");
    } finally {
      setLoading(false);
    }
  }

  // Busca automaticamente ao logar ou mudar período/turno
  useEffect(() => {
    if (userId) fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dateFrom, dateTo, filterShift]);

  // ─── Filtragem local por obra ────────────────────────────────
  const filteredRows = useMemo(() => {
    if (filterWorksite === "TODOS") return rows;
    return rows.filter((r) => r.worksiteName === filterWorksite);
  }, [rows, filterWorksite]);

  // ─── Totalizadores ──────────────────────────────────────────
  const totals = useMemo(() => {
    const lunch = filteredRows.filter((r) => r.shift === "ALMOCO").reduce((s, r) => s + r.qty, 0);
    const dinner = filteredRows.filter((r) => r.shift === "JANTA").reduce((s, r) => s + r.qty, 0);
    const confirmed = filteredRows.filter((r) => r.confirmedAt).length;
    return { lunch, dinner, total: lunch + dinner, confirmed, total_orders: filteredRows.length };
  }, [filteredRows]);

  // ─── LOGIN ──────────────────────────────────────────────────
  if (!userId) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48 }}>
          <header className="page-header" style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
              <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>Refeições</div>
              <div className="brand-text-sub">Histórico de pedidos</div>
            </div>
          </header>
          <div className="section-card" style={{ maxWidth: 420, margin: "0 auto" }}>
            <div className="section-header">
              <div>
                <div className="section-title">Entrar</div>
                <div className="section-subtitle">Use E-mail + PIN.</div>
              </div>
            </div>
            {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
            <label style={styles.label}>E-mail</label>
            <input style={styles.input} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="seu@email.com" autoCapitalize="none" />
            <div style={{ height: 10 }} />
            <label style={styles.label}>PIN</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} type={showPin ? "text" : "password"} value={loginPin} onChange={(e) => setLoginPin(e.target.value)} placeholder="••••••" />
              <button type="button" onClick={() => setShowPin((p) => !p)} style={{ borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", padding: "12px 12px", fontSize: 13, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}>
                {showPin ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <div style={{ height: 10 }} />
            <button type="button" onClick={doLogin} disabled={loggingIn} style={{ width: "100%", borderRadius: 14, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff", padding: "12px 12px", fontSize: 15, fontWeight: 950, cursor: loggingIn ? "not-allowed" : "pointer", opacity: loggingIn ? 0.7 : 1 }}>
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── PÁGINA PRINCIPAL ───────────────────────────────────────
  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 48 }}>

        {/* Header */}
        <header className="page-header" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 28, height: 28, objectFit: "contain", border: "none", background: "transparent" }} />
            <div>
              <div className="brand-text-main" style={{ lineHeight: 1.1 }}>Histórico</div>
              <div className="brand-text-sub">Pedidos de refeição</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail}</div>
            <button type="button" onClick={handleSignOut} style={{ borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 900, cursor: "pointer" }}>Sair</button>
          </div>
        </header>

        {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
        {okMsg ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>{okMsg}</div> : null}

        {/* Filtros */}
        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Filtros</div>
              <div className="section-subtitle">Período, turno e obra.</div>
            </div>
            <button
              type="button"
              onClick={fetchHistory}
              disabled={loading}
              style={{ borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 900, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}
            >
              {loading ? "Buscando..." : "Buscar"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>De</label>
              <input style={styles.input} type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Até</label>
              <input style={styles.input} type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Turno</label>
              <select style={styles.select} value={filterShift} onChange={(e) => setFilterShift(e.target.value as any)}>
                <option value="TODOS">Todos</option>
                <option value="ALMOCO">Almoço</option>
                <option value="JANTA">Janta</option>
              </select>
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Obra</label>
              <select style={styles.select} value={filterWorksite} onChange={(e) => setFilterWorksite(e.target.value)} disabled={worksiteOptions.length === 0}>
                <option value="TODOS">Todas</option>
                {worksiteOptions.map((w) => (
                  <option key={w.id} value={w.id}>{w.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Totalizadores */}
        {filteredRows.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 16 }}>
            <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoços</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#0f172a", lineHeight: 1.2 }}>{totals.lunch}</div>
            </div>
            <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Jantas</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#0f172a", lineHeight: 1.2 }}>{totals.dinner}</div>
            </div>
            <div style={{ borderRadius: 16, border: "1px solid #e2e8f0", background: "#f8fafc", padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#0f172a", lineHeight: 1.2 }}>{totals.total}</div>
            </div>
            <div style={{ borderRadius: 16, border: "1px solid #bbf7d0", background: "#f0fdf4", padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.08em" }}>Confirmados</div>
              <div style={{ fontSize: 22, fontWeight: 950, color: "#0f172a", lineHeight: 1.2 }}>{totals.confirmed}<span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>/{totals.total_orders}</span></div>
            </div>
          </div>
        ) : null}

        {/* Tabela */}
        <div className="section-card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="section-title">Pedidos</div>
              <div className="section-subtitle">{filteredRows.length} registro{filteredRows.length !== 1 ? "s" : ""}</div>
            </div>
            {filteredRows.length > 0 ? (
              <button
                type="button"
                onClick={() => downloadCSV(filteredRows)}
                style={{ borderRadius: 999, border: "1px solid #86efac", background: "#ecfdf5", color: "#166534", padding: "8px 14px", fontSize: 13, fontWeight: 900, cursor: "pointer" }}
              >
                ⬇ Exportar CSV
              </button>
            ) : null}
          </div>

          {loading ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--gp-muted-soft)" }}>Carregando…</div>
          ) : filteredRows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "var(--gp-muted-soft)" }}>
              Nenhum pedido encontrado para o período selecionado.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", whiteSpace: "nowrap" }}>Data</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Obra</th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Turno</th>
                    <th style={{ padding: "10px 16px", textAlign: "center", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Qtd</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", whiteSpace: "nowrap" }}>Status</th>
                    <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 900, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", whiteSpace: "nowrap" }}>Confirmado em</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r, i) => (
                    <tr key={r.orderId} style={{ borderTop: "1px solid #f1f5f9", background: i % 2 === 0 ? "#fff" : "#fafafa" }}>
                      <td style={{ padding: "10px 16px", fontWeight: 800, whiteSpace: "nowrap", color: "#0f172a" }}>
                        {formatBR(r.mealDate)}
                      </td>
                      <td style={{ padding: "10px 16px", color: "#334155", maxWidth: 200 }}>
                        {r.worksiteName}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center" }}>
                        <span style={{
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontSize: 11,
                          fontWeight: 900,
                          background: r.shift === "ALMOCO" ? "#ecfdf5" : "#eff6ff",
                          color: r.shift === "ALMOCO" ? "#166534" : "#1d4ed8",
                          border: `1px solid ${r.shift === "ALMOCO" ? "#86efac" : "#93c5fd"}`,
                          whiteSpace: "nowrap",
                        }}>
                          {shiftLabel(r.shift)}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 950, fontSize: 15, color: "#0f172a" }}>
                        {r.qty}
                      </td>
                      <td style={{ padding: "10px 16px", whiteSpace: "nowrap" }}>
                        <span style={{
                          borderRadius: 999,
                          padding: "3px 10px",
                          fontSize: 11,
                          fontWeight: 900,
                          background: r.confirmedAt ? "#dcfce7" : "#f1f5f9",
                          color: r.confirmedAt ? "#15803d" : "#64748b",
                          border: `1px solid ${r.confirmedAt ? "#86efac" : "#e2e8f0"}`,
                        }}>
                          {statusLabel(r.status, r.confirmedAt)}
                        </span>
                      </td>
                      <td style={{ padding: "10px 16px", color: "#475569", whiteSpace: "nowrap", fontSize: 12 }}>
                        {formatDateTime(r.confirmedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Rodapé com totais */}
                <tfoot>
                  <tr style={{ borderTop: "2px solid #e2e8f0", background: "#f8fafc" }}>
                    <td colSpan={3} style={{ padding: "10px 16px", fontWeight: 900, fontSize: 12, color: "#475569" }}>
                      Total do período
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "center", fontWeight: 950, fontSize: 16, color: "#0f172a" }}>
                      {totals.total}
                    </td>
                    <td colSpan={2} style={{ padding: "10px 16px", fontSize: 12, color: "#475569" }}>
                      {totals.confirmed} confirmado{totals.confirmed !== 1 ? "s" : ""} de {totals.total_orders} pedido{totals.total_orders !== 1 ? "s" : ""}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

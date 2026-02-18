// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type Mode = "ALMOCO" | "JANTA" | "AMBOS";

type Worksite = {
  id: string;
  label: string;
  restaurantId: string | null;
};

type Employee = {
  id: string;
  name: string;
  favorite: boolean;
};

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateBRFromISO(iso: string) {
  // iso: YYYY-MM-DD
  const [y, m, d] = (iso || "").split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function defaultModeByTime(): Mode {
  const now = new Date();
  const h = now.getHours();
  const m = now.getMinutes();
  const mins = h * 60 + m;
  // padrão: almoço até 11:00
  return mins < 11 * 60 ? "ALMOCO" : "JANTA";
}

function toggleSet(prev: Set<string>, id: string) {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// tenta extrair campos sem depender 100% do schema (pra não quebrar de novo)
function pickWorksite(row: any): Worksite | null {
  const id = row?.id ?? row?.worksite_id ?? row?.obra_id;
  if (!id) return null;

  const name =
    row?.name ??
    row?.nome ??
    row?.worksite_name ??
    row?.obra ??
    row?.titulo ??
    "Obra";

  const city = row?.city ?? row?.cidade ?? row?.worksite_city ?? "";
  const label = city ? `${String(name)} - ${String(city)}` : String(name);

  const restaurantId =
    row?.restaurant_id ??
    row?.default_restaurant_id ??
    row?.meal_restaurant_id ??
    row?.restaurante_id ??
    null;

  return { id: String(id), label, restaurantId: restaurantId ? String(restaurantId) : null };
}

function pickEmployee(row: any): Employee | null {
  const id = row?.employee_id ?? row?.id ?? row?.member_id ?? row?.person_id;
  const name =
    row?.employee_name ??
    row?.name ??
    row?.nome ??
    row?.full_name ??
    row?.funcionario ??
    row?.title;

  if (!id || !name) return null;

  const favorite = Boolean(row?.favorite ?? row?.is_favorite ?? row?.favorito ?? false);
  return { id: String(id), name: String(name), favorite };
}

async function loadWorksites(): Promise<{ rows: Worksite[]; error: string | null }> {
  // 1) meal_worksites
  try {
    const { data, error } = await supabase.from("meal_worksites").select("*").order("name", { ascending: true });
    if (!error && Array.isArray(data)) {
      const rows = data.map(pickWorksite).filter(Boolean) as Worksite[];
      if (rows.length) return { rows, error: null };
    }
  } catch {}

  // 2) meal_worksites_v
  try {
    const { data, error } = await supabase.from("meal_worksites_v").select("*").order("name", { ascending: true });
    if (!error && Array.isArray(data)) {
      const rows = data.map(pickWorksite).filter(Boolean) as Worksite[];
      if (rows.length) return { rows, error: null };
    }
    if (error) return { rows: [], error: error.message };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Falha ao carregar obras." };
  }

  return { rows: [], error: "Nenhuma obra encontrada." };
}

async function loadEmployees(worksiteId: string): Promise<{ rows: Employee[]; error: string | null }> {
  // 1) view pronta (melhor)
  try {
    const { data, error } = await supabase
      .from("meal_worksite_members_v")
      .select("*")
      .eq("worksite_id", worksiteId);
    if (!error && Array.isArray(data)) {
      const rows = data.map(pickEmployee).filter(Boolean) as Employee[];
      if (rows.length) {
        rows.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name));
        return { rows, error: null };
      }
    }
  } catch {}

  // 2) employees direto (se existir worksite_id lá)
  try {
    const { data, error } = await supabase.from("meal_employees").select("*").eq("worksite_id", worksiteId);
    if (!error && Array.isArray(data)) {
      const rows = data.map(pickEmployee).filter(Boolean) as Employee[];
      if (rows.length) {
        rows.sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || a.name.localeCompare(b.name));
        return { rows, error: null };
      }
    }
    if (error) return { rows: [], error: error.message };
  } catch (e: any) {
    return { rows: [], error: e?.message || "Falha ao carregar funcionários." };
  }

  return { rows: [], error: "Nenhum funcionário encontrado para esta obra." };
}

async function findOrCreateOrder(args: {
  worksiteId: string;
  restaurantId: string | null;
  mealDateISO: string;
  shift: Shift;
}): Promise<{ orderId: string | null; restaurantId: string | null; error: string | null }> {
  const { worksiteId, restaurantId, mealDateISO, shift } = args;

  // tenta achar
  try {
    const q = supabase
      .from("meal_orders")
      .select("id, restaurant_id, created_at")
      .eq("worksite_id", worksiteId)
      .eq("meal_date", mealDateISO)
      .eq("shift", shift)
      .order("created_at", { ascending: false })
      .limit(1);

    const { data, error } = await q.maybeSingle();
    if (!error && data?.id) {
      return {
        orderId: String(data.id),
        restaurantId: data.restaurant_id ? String(data.restaurant_id) : restaurantId,
        error: null,
      };
    }
  } catch {}

  // criar (precisa de restaurant_id)
  const rid = restaurantId;
  if (!rid) return { orderId: null, restaurantId: null, error: "Esta obra não tem restaurante vinculado (restaurant_id)." };

  try {
    const { data, error } = await supabase
      .from("meal_orders")
      .insert({
        worksite_id: worksiteId,
        restaurant_id: rid,
        order_date: mealDateISO,
        meal_date: mealDateISO,
        shift,
        status: "DRAFT",
      })
      .select("id, restaurant_id")
      .single();

    if (error) return { orderId: null, restaurantId: rid, error: error.message };
    return { orderId: String(data.id), restaurantId: data.restaurant_id ? String(data.restaurant_id) : rid, error: null };
  } catch (e: any) {
    return { orderId: null, restaurantId: rid, error: e?.message || "Falha ao criar pedido." };
  }
}

async function loadSavedSet(worksiteId: string, mealDateISO: string, shift: Shift) {
  try {
    const { data: order, error: orderErr } = await supabase
      .from("meal_orders")
      .select("id, created_at")
      .eq("worksite_id", worksiteId)
      .eq("meal_date", mealDateISO)
      .eq("shift", shift)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (orderErr || !order?.id) return { orderId: null as string | null, set: new Set<string>(), error: orderErr?.message ?? null };

    const orderId = String(order.id);

    const { data: lines, error: linesErr } = await supabase
      .from("meal_order_lines")
      .select("employee_id, included")
      .eq("meal_order_id", orderId)
      .eq("included", true);

    if (linesErr) return { orderId, set: new Set<string>(), error: linesErr.message };

    const s = new Set<string>();
    for (const r of lines || []) {
      const eid = (r as any)?.employee_id;
      if (eid) s.add(String(eid));
    }
    return { orderId, set: s, error: null };
  } catch (e: any) {
    return { orderId: null as string | null, set: new Set<string>(), error: e?.message || "Falha ao carregar salvos." };
  }
}

async function overwriteOrderLines(orderId: string, employeeIds: string[]) {
  // estratégia simples e robusta (gera audit de DELETE/INSERT e resolve 99% dos casos)
  const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
  if (del.error) return { error: del.error.message };

  if (!employeeIds.length) return { error: null };

  const payload = employeeIds.map((eid) => ({
    meal_order_id: orderId,
    employee_id: eid,
    included: true,
    is_exception: false,
  }));

  const ins = await supabase.from("meal_order_lines").insert(payload);
  if (ins.error) return { error: ins.error.message };

  return { error: null };
}

export default function RefeicoesPage() {
  const [email, setEmail] = useState<string | null>(null);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");
  const worksite = useMemo(() => worksites.find((w) => w.id === worksiteId) || null, [worksites, worksiteId]);

  const [mealDateISO, setMealDateISO] = useState<string>(isoToday());
  const [mode, setMode] = useState<Mode>(defaultModeByTime());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);

  const [savedLunch, setSavedLunch] = useState<Set<string>>(new Set());
  const [savedDinner, setSavedDinner] = useState<Set<string>>(new Set());

  const [selLunch, setSelLunch] = useState<Set<string>>(new Set());
  const [selDinner, setSelDinner] = useState<Set<string>>(new Set());

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // carregar usuário
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      setEmail(data?.user?.email ?? null);
    })();
  }, []);

  // carregar obras
  useEffect(() => {
    (async () => {
      setError(null);
      const res = await loadWorksites();
      if (res.error) setError(res.error);
      setWorksites(res.rows);
      if (res.rows.length && !worksiteId) setWorksiteId(res.rows[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // se mudar data, ajusta modo padrão baseado na hora (somente quando usuário não mexeu? aqui simples)
  useEffect(() => {
    setMode(defaultModeByTime());
  }, [mealDateISO]);

  async function reloadAll() {
    if (!worksiteId) return;
    setError(null);
    setHint(null);

    // employees
    const emp = await loadEmployees(worksiteId);
    if (emp.error) setError(emp.error);
    setEmployees(emp.rows);

    // saved
    const lunch = await loadSavedSet(worksiteId, mealDateISO, "ALMOCO");
    const dinner = await loadSavedSet(worksiteId, mealDateISO, "JANTA");

    if (lunch.error) setError(lunch.error);
    if (dinner.error) setError(dinner.error);

    setSavedLunch(lunch.set);
    setSavedDinner(dinner.set);

    // por padrão, começa marcando o que já está salvo
    setSelLunch(new Set(lunch.set));
    setSelDinner(new Set(dinner.set));
  }

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, mealDateISO]);

  function toggleEmployeeByMode(empId: string) {
    if (mode === "ALMOCO") {
      setSelLunch((p) => toggleSet(p, empId));
      return;
    }
    if (mode === "JANTA") {
      setSelDinner((p) => toggleSet(p, empId));
      return;
    }
    // ambos: alterna almoço por padrão no tap (e botõezinhos fazem o resto)
    setSelLunch((p) => toggleSet(p, empId));
  }

  function isMarkedAny(empId: string) {
    if (mode === "ALMOCO") return selLunch.has(empId);
    if (mode === "JANTA") return selDinner.has(empId);
    return selLunch.has(empId) || selDinner.has(empId);
  }

  const filteredEmployees = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    return employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (onlyMarked && !isMarkedAny(e.id)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, search, onlyMarked, selLunch, selDinner, mode]);

  const counts = useMemo(() => {
    return {
      lunch: selLunch.size,
      dinner: selDinner.size,
      savedLunch: savedLunch.size,
      savedDinner: savedDinner.size,
    };
  }, [selLunch, selDinner, savedLunch, savedDinner]);

  async function handleSave() {
    if (!worksiteId) return;
    setBusy(true);
    setError(null);
    setHint(null);

    try {
      const restaurantId = worksite?.restaurantId ?? null;

      const doShift = async (shift: Shift, ids: string[]) => {
        const created = await findOrCreateOrder({
          worksiteId,
          restaurantId,
          mealDateISO,
          shift,
        });
        if (created.error || !created.orderId) throw new Error(created.error || "Falha ao criar/achar pedido.");

        const ow = await overwriteOrderLines(created.orderId, ids);
        if (ow.error) throw new Error(ow.error);
      };

      if (mode === "ALMOCO") await doShift("ALMOCO", Array.from(selLunch));
      else if (mode === "JANTA") await doShift("JANTA", Array.from(selDinner));
      else {
        await doShift("ALMOCO", Array.from(selLunch));
        await doShift("JANTA", Array.from(selDinner));
      }

      // recarrega salvos
      await reloadAll();
      setHint("Salvo com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelSaved() {
    if (!worksiteId) return;
    setBusy(true);
    setError(null);
    setHint(null);

    try {
      const cancelShift = async (shift: Shift) => {
        const saved = await loadSavedSet(worksiteId, mealDateISO, shift);
        if (saved.error) throw new Error(saved.error);
        if (!saved.orderId) return; // nada salvo
        const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", saved.orderId);
        if (del.error) throw new Error(del.error.message);
      };

      if (mode === "ALMOCO") await cancelShift("ALMOCO");
      else if (mode === "JANTA") await cancelShift("JANTA");
      else {
        await cancelShift("ALMOCO");
        await cancelShift("JANTA");
      }

      await reloadAll();
      setHint("Cancelado (linhas apagadas).");
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  function handleRestoreSaved() {
    setSelLunch(new Set(savedLunch));
    setSelDinner(new Set(savedDinner));
    setHint("Restaurado o que estava salvo.");
  }

  function handleClear() {
    if (mode === "ALMOCO") setSelLunch(new Set());
    else if (mode === "JANTA") setSelDinner(new Set());
    else {
      setSelLunch(new Set());
      setSelDinner(new Set());
    }
  }

  function handleAll() {
    const all = employees.map((e) => e.id);
    if (mode === "ALMOCO") setSelLunch(new Set(all));
    else if (mode === "JANTA") setSelDinner(new Set(all));
    else {
      setSelLunch(new Set(all));
      setSelDinner(new Set(all));
    }
  }

  async function handleCopySummary() {
    const lunchNames = employees.filter((e) => selLunch.has(e.id)).map((e) => e.name);
    const dinnerNames = employees.filter((e) => selDinner.has(e.id)).map((e) => e.name);

    const msg =
      `🍽️ Refeições - ${worksite?.label ?? "Obra"} - ${formatDateBRFromISO(mealDateISO)}\n\n` +
      `Almoço (${lunchNames.length}):\n${lunchNames.join("\n") || "-"}\n\n` +
      `Janta (${dinnerNames.length}):\n${dinnerNames.join("\n") || "-"}`;

    try {
      await navigator.clipboard.writeText(msg);
      setHint("Resumo copiado.");
    } catch {
      // fallback simples
      alert(msg);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  // estilos (sem funções dentro do objeto tipado)
  const styles: Record<string, CSSProperties> = {
    label: {
      fontSize: 12,
      fontWeight: 800,
      color: "var(--gp-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      display: "block",
      marginBottom: 6,
    },
    input: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 16,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    cardRow: {
      display: "grid",
      gridTemplateColumns: "repeat(12, 1fr)",
      gap: 12,
      alignItems: "end",
    },
    pill: {
      borderRadius: 999,
      border: "1px solid #e5e7eb",
      background: "#fff",
      padding: "10px 12px",
      fontSize: 14,
      fontWeight: 700,
      cursor: "pointer",
      lineHeight: 1,
      whiteSpace: "nowrap",
    },
  };

  const segBtnStyle = (active: boolean, tone: "lunch" | "dinner" | "both"): CSSProperties => {
    const base: CSSProperties = {
      ...styles.pill,
      borderColor: "#e5e7eb",
      color: "#0f172a",
      background: "#fff",
    };

    if (!active) return base;

    if (tone === "lunch") return { ...base, background: "#ecfdf5", borderColor: "#86efac", color: "#166534" };
    if (tone === "dinner") return { ...base, background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" };
    return { ...base, background: "#f8fafc", borderColor: "#cbd5e1", color: "#0f172a" };
  };

  const chipStyle = (active: boolean, tone: "lunch" | "dinner"): CSSProperties => {
    const base: CSSProperties = {
      borderRadius: 999,
      padding: "8px 10px",
      fontSize: 12,
      fontWeight: 800,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "#64748b",
      lineHeight: 1,
      cursor: mode === "AMBOS" ? "pointer" : "default",
      userSelect: "none",
    };

    if (!active) return base;

    if (tone === "lunch") return { ...base, background: "#ecfdf5", borderColor: "#86efac", color: "#166534" };
    return { ...base, background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" };
  };

  const bottomTitle =
    mode === "ALMOCO" ? `Salvar Almoço (${counts.lunch})` : mode === "JANTA" ? `Salvar Janta (${counts.dinner})` : `Salvar Ambos (${counts.lunch + counts.dinner})`;

  return (
    <div className="page-root">
      <style jsx>{`
        .meals-wrap {
          padding-bottom: 220px; /* ✅ garante que dá pra rolar até o último funcionário */
        }
        .empRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 14px 14px;
          border-radius: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
          cursor: pointer;
        }
        .empName {
          font-size: 15px;
          font-weight: 750;
          color: var(--gp-text);
          letter-spacing: 0.01em;
        }
        .favTag {
          margin-left: 10px;
          font-size: 11px;
          font-weight: 800;
          padding: 6px 10px;
          border-radius: 999px;
          background: #fff7ed;
          border: 1px solid #fed7aa;
          color: #9a3412;
          text-transform: lowercase;
        }
        .stickyBar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 12px;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(10px);
          border-top: 1px solid #e5e7eb;
          z-index: 50;
        }
        .stickyInner {
          max-width: 980px;
          margin: 0 auto;
        }
        .btnPrimary {
          width: 100%;
          border-radius: 16px;
          padding: 14px 16px;
          font-weight: 900;
          font-size: 16px;
          border: 1px solid #93c5fd;
          background: #2563eb;
          color: #fff;
          cursor: pointer;
        }
        .btnDanger {
          width: 100%;
          border-radius: 16px;
          padding: 14px 16px;
          font-weight: 900;
          font-size: 16px;
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          cursor: pointer;
        }
        .btnGhost {
          width: 100%;
          border-radius: 16px;
          padding: 14px 16px;
          font-weight: 900;
          font-size: 16px;
          border: 1px solid #e5e7eb;
          background: #ffffff;
          color: #0f172a;
          cursor: pointer;
        }
        .smallNote {
          font-size: 12px;
          color: var(--gp-muted-soft);
          margin-top: 8px;
        }
      `}</style>

      <div className="page-container">
        <header className="page-header" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 44, height: 44, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div>
              <div className="brand-text-main" style={{ lineHeight: 1.05 }}>Refeições</div>
              <div className="brand-text-sub" style={{ marginTop: 2 }}>Marcar rápido • Conferir • Salvar</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                padding: "10px 12px",
                background: "#fff",
                fontWeight: 800,
                fontSize: 13,
                color: "#0f172a",
                whiteSpace: "nowrap",
              }}
            >
              {formatDateBRFromISO(mealDateISO)}
            </div>
            <button
              onClick={handleSignOut}
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "10px 14px",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Sair
            </button>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">
                {email ? <>Logado: <b>{email}</b></> : " "}
              </div>
            </div>
          </div>

          {error ? (
            <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>
              {error}
            </div>
          ) : null}

          {hint ? (
            <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>
              {hint}
            </div>
          ) : null}

          <div style={styles.cardRow}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra</label>
              <select style={styles.input} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={mealDateISO} onChange={(e) => setMealDateISO(e.target.value)} />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Buscar</label>
              <input style={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do funcionário..." />
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={segBtnStyle(mode === "ALMOCO", "lunch")} onClick={() => setMode("ALMOCO")}>Almoço</button>
                <button style={segBtnStyle(mode === "JANTA", "dinner")} onClick={() => setMode("JANTA")}>Janta</button>
                <button style={segBtnStyle(mode === "AMBOS", "both")} onClick={() => setMode("AMBOS")}>Ambos</button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, color: "#0f172a" }}>
                <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
                Mostrar só marcados
              </label>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button style={styles.pill} onClick={handleRestoreSaved}>Restaurar salvo</button>
              <button style={styles.pill} onClick={handleAll}>Todos</button>
              <button style={styles.pill} onClick={handleClear}>Limpar</button>
              <button style={styles.pill} onClick={handleCopySummary}>Copiar resumo</button>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ ...chipStyle(true, "lunch"), cursor: "default" }}>
                  Almoço: <b>{counts.lunch}</b> (salvo: {counts.savedLunch})
                </span>
                <span style={{ ...chipStyle(true, "dinner"), cursor: "default" }}>
                  Janta: <b>{counts.dinner}</b> (salvo: {counts.savedDinner})
                </span>
              </div>
            </div>

            <div style={{ gridColumn: "span 12" }} className="smallNote">
              Padrão: abre <b>Almoço</b> até 11h, depois <b>Janta</b>.
            </div>
          </div>
        </div>

        <div className="meals-wrap" style={{ marginTop: 14, display: "grid", gap: 12 }}>
          {filteredEmployees.map((e) => {
            const lunchOn = selLunch.has(e.id);
            const dinnerOn = selDinner.has(e.id);

            const bg =
              mode === "ALMOCO" && lunchOn ? "#ecfdf5" :
              mode === "JANTA" && dinnerOn ? "#eff6ff" :
              "#ffffff";

            const bd =
              mode === "ALMOCO" && lunchOn ? "#86efac" :
              mode === "JANTA" && dinnerOn ? "#93c5fd" :
              "#e5e7eb";

            return (
              <div
                key={e.id}
                className="empRow"
                onClick={() => toggleEmployeeByMode(e.id)}
                style={{ background: bg, borderColor: bd }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div className="empName" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {e.name}
                    {e.favorite ? <span className="favTag">favorito</span> : null}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    style={chipStyle(lunchOn, "lunch")}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (mode === "AMBOS" || mode === "ALMOCO") setSelLunch((p) => toggleSet(p, e.id));
                    }}
                  >
                    A
                  </span>
                  <span
                    style={chipStyle(dinnerOn, "dinner")}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      if (mode === "AMBOS" || mode === "JANTA") setSelDinner((p) => toggleSet(p, e.id));
                    }}
                  >
                    J
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ✅ Barra fixa final (botões largos) */}
      <div className="stickyBar">
        <div className="stickyInner" style={{ display: "grid", gap: 10 }}>
          <button className="btnPrimary" onClick={handleSave} disabled={busy}>
            {busy ? "Salvando..." : bottomTitle}
          </button>
          <button className="btnDanger" onClick={handleCancelSaved} disabled={busy}>
            {busy ? "Aguarde..." : mode === "ALMOCO" ? "Cancelar Almoço (salvo)" : mode === "JANTA" ? "Cancelar Janta (salvo)" : "Cancelar Ambos (salvo)"}
          </button>
          <button className="btnGhost" onClick={handleCopySummary}>
            Copiar resumo
          </button>
        </div>
      </div>
    </div>
  );
}

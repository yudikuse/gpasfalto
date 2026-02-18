// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type MealShift = "LUNCH" | "DINNER";
type ViewShift = "LUNCH" | "DINNER" | "BOTH";

type Worksite = { id: string; name: string; city: string | null; active: boolean | null };
type Employee = { id: string; full_name: string; active: boolean | null; is_third_party: boolean | null };

type Contract = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  start_date: string | null;
  end_date: string | null;
  cutoff_lunch: string | null; // time
  cutoff_dinner: string | null; // time
  allow_after_cutoff: boolean | null;
};

type MealOrder = {
  id: string;
  shift: MealShift;
  status: string;
  worksite_id: string;
  restaurant_id: string;
  meal_date: string; // date
  cutoff_at: string | null; // timestamptz
};

type MealOrderLine = {
  id: string;
  meal_order_id: string;
  employee_id: string | null;
  visitor_name: string | null;
  included: boolean | null;
};

function isoToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateBRFromISO(iso: string) {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function normalizeTimeHHMM(t: string | null) {
  if (!t) return null;
  // Supabase "time" geralmente vem "09:30:00"
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function cutoffToISO(dateISO: string, hhmm: string) {
  // interpreta como local e converte pra ISO (UTC) pro timestamptz
  const dt = new Date(`${dateISO}T${hhmm}:00`);
  return dt.toISOString();
}

function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function cmpHHMM(a: string, b: string) {
  // retorna -1/0/1 comparando "HH:MM"
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export default function RefeicoesPage() {
  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [mealDate, setMealDate] = useState<string>(isoToday());

  const [contract, setContract] = useState<Contract | null>(null);
  const [cutLunch, setCutLunch] = useState<string | null>(null);
  const [cutDinner, setCutDinner] = useState<string | null>(null);
  const [allowAfter, setAllowAfter] = useState<boolean>(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);

  const [viewShift, setViewShift] = useState<ViewShift>(() => {
    // padrão: almoço até 11h, depois janta
    const hhmm = nowHHMM();
    return cmpHHMM(hhmm, "11:00") <= 0 ? "LUNCH" : "DINNER";
  });

  // Seleção "marcados agora" (draft local)
  const [draftLunch, setDraftLunch] = useState<Set<string>>(new Set());
  const [draftDinner, setDraftDinner] = useState<Set<string>>(new Set());

  // "salvo" vindo do banco
  const [savedLunch, setSavedLunch] = useState<Set<string>>(new Set());
  const [savedDinner, setSavedDinner] = useState<Set<string>>(new Set());
  const [savedVisitorsLunch, setSavedVisitorsLunch] = useState<number>(0);
  const [savedVisitorsDinner, setSavedVisitorsDinner] = useState<number>(0);

  const [orderLunch, setOrderLunch] = useState<MealOrder | null>(null);
  const [orderDinner, setOrderDinner] = useState<MealOrder | null>(null);

  const styles = {
    label: {
      fontSize: 12,
      fontWeight: 800,
      color: "var(--gp-muted)",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      display: "block",
      marginBottom: 6,
    } as CSSProperties,
    input: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 16,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    } as CSSProperties,
    pill: {
      borderRadius: 999,
      border: "1px solid #e5e7eb",
      padding: "8px 12px",
      background: "#fff",
      fontWeight: 800,
      fontSize: 13,
      color: "#0f172a",
      whiteSpace: "nowrap",
    } as CSSProperties,
    btnPrimary: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #1d4ed8",
      background: busy ? "#94a3b8" : "#2563eb",
      color: "#fff",
      fontWeight: 900,
      padding: "14px 14px",
      cursor: busy ? "not-allowed" : "pointer",
      fontSize: 16,
      boxShadow: busy ? "none" : "0 16px 30px rgba(37,99,235,0.18)",
    } as CSSProperties,
    btnDanger: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#991b1b",
      fontWeight: 900,
      padding: "14px 14px",
      cursor: busy ? "not-allowed" : "pointer",
      fontSize: 16,
    } as CSSProperties,
    btnGhost: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      color: "#0f172a",
      fontWeight: 900,
      padding: "12px 14px",
      cursor: busy ? "not-allowed" : "pointer",
      fontSize: 14,
    } as CSSProperties,
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 } as CSSProperties,
  };

  const segBtnStyle = (active: boolean): CSSProperties => ({
    borderRadius: 999,
    border: active ? "1px solid #cbd5e1" : "1px solid #e5e7eb",
    padding: "8px 12px",
    background: active ? "#f8fafc" : "#fff",
    fontWeight: 900,
    fontSize: 13,
    color: "#0f172a",
    cursor: "pointer",
  });

  const employeeRowStyle = (selected: boolean, tone: MealShift): CSSProperties => {
    const bg = selected ? (tone === "LUNCH" ? "#ecfdf5" : "#eff6ff") : "#ffffff";
    const bd = selected ? (tone === "LUNCH" ? "#86efac" : "#93c5fd") : "#e5e7eb";
    return {
      borderRadius: 16,
      border: `1px solid ${bd}`,
      background: bg,
      padding: "12px 12px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      cursor: "pointer",
      userSelect: "none",
    };
  };

  async function loadSessionAndWorksites() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const u = auth?.user;
      if (!u) {
        setError("Você não está logado.");
        setLoading(false);
        return;
      }
      setUserEmail(u.email || "");
      setUserId(u.id);

      // worksites do usuário via meal_worksite_members (user_id)
      const mem = await supabase
        .from("meal_worksite_members")
        .select("worksite_id")
        .eq("user_id", u.id);

      if (mem.error) throw new Error(mem.error.message);

      const ids = (mem.data || []).map((r: any) => r.worksite_id).filter(Boolean);
      if (!ids.length) {
        setWorksites([]);
        setWorksiteId("");
        setLoading(false);
        return;
      }

      const ws = await supabase
        .from("meal_worksites")
        .select("id,name,city,active")
        .in("id", ids)
        .order("name", { ascending: true });

      if (ws.error) throw new Error(ws.error.message);

      const list = (ws.data || []) as Worksite[];
      setWorksites(list);

      // seleciona o 1º ativo por padrão
      const first = list.find((x) => x.active !== false) || list[0];
      setWorksiteId(first?.id || "");
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar sessão/obras.");
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployees() {
    try {
      // meal_employees NÃO tem worksite_id (é global). Só filtra active.
      const r = await supabase
        .from("meal_employees")
        .select("id,full_name,active,is_third_party")
        .eq("active", true)
        .order("full_name", { ascending: true });

      if (r.error) throw new Error(r.error.message);
      setEmployees((r.data || []) as Employee[]);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar funcionários.");
    }
  }

  async function loadContractAndSaved() {
    if (!worksiteId || !mealDate) return;

    setError(null);
    setInfo(null);

    try {
      // contrato ativo na data
      const c = await supabase
        .from("meal_contracts")
        .select("id,worksite_id,restaurant_id,start_date,end_date,cutoff_lunch,cutoff_dinner,allow_after_cutoff")
        .eq("worksite_id", worksiteId)
        .lte("start_date", mealDate)
        .gte("end_date", mealDate)
        .order("start_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (c.error) throw new Error(c.error.message);

      const con = (c.data as Contract | null) || null;
      setContract(con);

      const cl = normalizeTimeHHMM(con?.cutoff_lunch || null);
      const cd = normalizeTimeHHMM(con?.cutoff_dinner || null);
      setCutLunch(cl);
      setCutDinner(cd);
      setAllowAfter(Boolean(con?.allow_after_cutoff));

      // favoritos por obra
      const fav = await supabase
        .from("meal_worksite_favorites")
        .select("employee_id")
        .eq("worksite_id", worksiteId);

      if (fav.error) throw new Error(fav.error.message);

      const favSet = new Set<string>((fav.data || []).map((x: any) => x.employee_id).filter(Boolean));
      setFavorites(favSet);

      // pedidos salvos (LUNCH/DINNER)
      const o = await supabase
        .from("meal_orders")
        .select("id,shift,status,worksite_id,restaurant_id,meal_date,cutoff_at")
        .eq("worksite_id", worksiteId)
        .eq("meal_date", mealDate)
        .in("shift", ["LUNCH", "DINNER"])
        .order("created_at", { ascending: false });

      if (o.error) throw new Error(o.error.message);

      const orders = (o.data || []) as MealOrder[];
      const lunch = orders.find((x) => x.shift === "LUNCH") || null;
      const dinner = orders.find((x) => x.shift === "DINNER") || null;
      setOrderLunch(lunch);
      setOrderDinner(dinner);

      const ids = orders.map((x) => x.id);
      if (!ids.length) {
        setSavedLunch(new Set());
        setSavedDinner(new Set());
        setSavedVisitorsLunch(0);
        setSavedVisitorsDinner(0);
        return;
      }

      const lines = await supabase
        .from("meal_order_lines")
        .select("id,meal_order_id,employee_id,visitor_name,included")
        .in("meal_order_id", ids);

      if (lines.error) throw new Error(lines.error.message);

      const byOrder = new Map<string, MealOrderLine[]>();
      for (const ln of (lines.data || []) as MealOrderLine[]) {
        const arr = byOrder.get(ln.meal_order_id) || [];
        arr.push(ln);
        byOrder.set(ln.meal_order_id, arr);
      }

      const build = (ord: MealOrder | null) => {
        const set = new Set<string>();
        let visitors = 0;
        if (!ord) return { set, visitors };
        const arr = byOrder.get(ord.id) || [];
        for (const ln of arr) {
          if (ln.included === false) continue;
          if (ln.employee_id) set.add(ln.employee_id);
          else if (ln.visitor_name) visitors += 1;
        }
        return { set, visitors };
      };

      const a = build(lunch);
      const b = build(dinner);

      setSavedLunch(a.set);
      setSavedDinner(b.set);
      setSavedVisitorsLunch(a.visitors);
      setSavedVisitorsDinner(b.visitors);

      // também sincroniza o draft na 1ª carga (pra começar “batendo” com salvo)
      setDraftLunch(new Set(a.set));
      setDraftDinner(new Set(b.set));
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar contrato/salvos.");
    }
  }

  useEffect(() => {
    loadSessionAndWorksites();
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadContractAndSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, mealDate]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();

    const isMarked = (id: string) => {
      if (viewShift === "LUNCH") return draftLunch.has(id);
      if (viewShift === "DINNER") return draftDinner.has(id);
      return draftLunch.has(id) || draftDinner.has(id);
    };

    return employees
      .filter((e) => (q ? e.full_name.toLowerCase().includes(q) : true))
      .filter((e) => (onlyMarked ? isMarked(e.id) : true))
      .sort((a, b) => {
        const af = favorites.has(a.id) ? 1 : 0;
        const bf = favorites.has(b.id) ? 1 : 0;
        if (af !== bf) return bf - af;
        return a.full_name.localeCompare(b.full_name);
      });
  }, [employees, search, onlyMarked, favorites, draftLunch, draftDinner, viewShift]);

  const counts = useMemo(() => {
    const draftL = draftLunch.size;
    const draftD = draftDinner.size;
    const savedL = savedLunch.size + savedVisitorsLunch;
    const savedD = savedDinner.size + savedVisitorsDinner;
    return { draftL, draftD, savedL, savedD };
  }, [draftLunch, draftDinner, savedLunch, savedDinner, savedVisitorsLunch, savedVisitorsDinner]);

  function toggleEmployee(id: string) {
    setError(null);
    setInfo(null);

    if (viewShift === "LUNCH") {
      setDraftLunch((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
      return;
    }

    if (viewShift === "DINNER") {
      setDraftDinner((prev) => {
        const n = new Set(prev);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      });
      return;
    }

    // BOTH: alterna em ambos (rápido pra marcar o cara pros 2 turnos)
    setDraftLunch((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setDraftDinner((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function restoreSaved() {
    setDraftLunch(new Set(savedLunch));
    setDraftDinner(new Set(savedDinner));
    setInfo("Restaurado do salvo.");
  }

  function clearDraft() {
    if (viewShift === "LUNCH") setDraftLunch(new Set());
    else if (viewShift === "DINNER") setDraftDinner(new Set());
    else {
      setDraftLunch(new Set());
      setDraftDinner(new Set());
    }
    setInfo("Limpo.");
  }

  function canSaveShift(shift: MealShift) {
    if (!contract) return { ok: false, reason: "Sem contrato ativo para esta obra/data." };

    // trava por cutoff apenas se for hoje e allow_after_cutoff = false
    if (allowAfter) return { ok: true, reason: "" };
    if (mealDate !== isoToday()) return { ok: true, reason: "" };

    const hhmm = nowHHMM();
    const cutoff = shift === "LUNCH" ? cutLunch : cutDinner;
    if (!cutoff) return { ok: true, reason: "" };

    if (cmpHHMM(hhmm, cutoff) === 1) {
      return { ok: false, reason: `Passou do limite de ${shift === "LUNCH" ? "almoço" : "janta"} (${cutoff}).` };
    }
    return { ok: true, reason: "" };
  }

  async function ensureOrder(shift: MealShift): Promise<MealOrder> {
    if (!contract) throw new Error("Sem contrato ativo.");

    // tenta pegar existente
    const existing = await supabase
      .from("meal_orders")
      .select("id,shift,status,worksite_id,restaurant_id,meal_date,cutoff_at")
      .eq("worksite_id", worksiteId)
      .eq("meal_date", mealDate)
      .eq("shift", shift)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing.error) throw new Error(existing.error.message);

    if (existing.data) {
      const ord = existing.data as MealOrder;
      if (String(ord.status || "").toUpperCase() !== "DRAFT") {
        throw new Error("Este pedido não está mais em DRAFT (já foi enviado/confirmado).");
      }
      return ord;
    }

    const cutoff = shift === "LUNCH" ? cutLunch : cutDinner;
    const cutoff_at = cutoff ? cutoffToISO(mealDate, cutoff) : null;

    const ins = await supabase
      .from("meal_orders")
      .insert({
        worksite_id: worksiteId,
        restaurant_id: contract.restaurant_id,
        meal_date: mealDate,
        order_date: mealDate, // igual ao seu audit
        shift,
        status: "DRAFT",
        cutoff_at,
      })
      .select("id,shift,status,worksite_id,restaurant_id,meal_date,cutoff_at")
      .single();

    if (ins.error) throw new Error(ins.error.message);
    return ins.data as MealOrder;
  }

  async function saveShift(shift: MealShift) {
    setError(null);
    setInfo(null);

    const chk = canSaveShift(shift);
    if (!chk.ok) {
      setError(chk.reason);
      return;
    }

    const selected = shift === "LUNCH" ? draftLunch : draftDinner;

    setBusy(true);
    try {
      const ord = await ensureOrder(shift);

      // apaga linhas anteriores e recria (simples e confiável)
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", ord.id);
      if (del.error) throw new Error(del.error.message);

      const rows = Array.from(selected).map((employee_id) => ({
        meal_order_id: ord.id,
        employee_id,
        included: true,
        note: null,
        is_exception: false,
        exception_reason: null,
      }));

      if (rows.length) {
        const ins = await supabase.from("meal_order_lines").insert(rows);
        if (ins.error) throw new Error(ins.error.message);
      }

      setInfo(`Salvo ${shift === "LUNCH" ? "Almoço" : "Janta"} (${rows.length}).`);

      // recarrega salvos
      await loadContractAndSaved();
    } catch (e: any) {
      setError(e?.message || "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelShift(shift: MealShift) {
    setError(null);
    setInfo(null);

    const ord = shift === "LUNCH" ? orderLunch : orderDinner;
    if (!ord) {
      // nada salvo: só limpa o draft
      if (shift === "LUNCH") setDraftLunch(new Set());
      else setDraftDinner(new Set());
      setInfo("Nada salvo para cancelar.");
      return;
    }

    setBusy(true);
    try {
      if (String(ord.status || "").toUpperCase() !== "DRAFT") {
        throw new Error("Este pedido não está mais em DRAFT (já foi enviado/confirmado).");
      }

      // ✅ cancelamento = DELETE do pedido/linhas (vai pro audit como DELETE)
      const dl = await supabase.from("meal_order_lines").delete().eq("meal_order_id", ord.id);
      if (dl.error) throw new Error(dl.error.message);

      const doo = await supabase.from("meal_orders").delete().eq("id", ord.id);
      if (doo.error) throw new Error(doo.error.message);

      if (shift === "LUNCH") setDraftLunch(new Set());
      else setDraftDinner(new Set());

      setInfo(`Cancelado ${shift === "LUNCH" ? "Almoço" : "Janta"}.`);

      await loadContractAndSaved();
    } catch (e: any) {
      setError(e?.message || "Falha ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  async function copyYesterday() {
    if (!worksiteId) return;
    setError(null);
    setInfo(null);

    const d = new Date(mealDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const yISO = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    setBusy(true);
    try {
      const o = await supabase
        .from("meal_orders")
        .select("id,shift,status,worksite_id,restaurant_id,meal_date,cutoff_at")
        .eq("worksite_id", worksiteId)
        .eq("meal_date", yISO)
        .in("shift", ["LUNCH", "DINNER"]);

      if (o.error) throw new Error(o.error.message);

      const orders = (o.data || []) as MealOrder[];
      const ids = orders.map((x) => x.id);
      if (!ids.length) {
        setInfo("Ontem não tem pedido salvo.");
        return;
      }

      const lines = await supabase
        .from("meal_order_lines")
        .select("meal_order_id,employee_id,included,visitor_name")
        .in("meal_order_id", ids);

      if (lines.error) throw new Error(lines.error.message);

      const byOrder = new Map<string, MealOrderLine[]>();
      for (const ln of (lines.data || []) as any[]) {
        const arr = byOrder.get(ln.meal_order_id) || [];
        arr.push(ln);
        byOrder.set(ln.meal_order_id, arr);
      }

      const getSet = (shift: MealShift) => {
        const ord = orders.find((x) => x.shift === shift);
        const set = new Set<string>();
        if (!ord) return set;
        const arr = byOrder.get(ord.id) || [];
        for (const ln of arr) {
          if (ln.included === false) continue;
          if (ln.employee_id) set.add(ln.employee_id);
        }
        return set;
      };

      setDraftLunch(getSet("LUNCH"));
      setDraftDinner(getSet("DINNER"));
      setInfo("Copiado de ontem (apenas funcionários).");
    } catch (e: any) {
      setError(e?.message || "Falha ao copiar ontem.");
    } finally {
      setBusy(false);
    }
  }

  async function copyResumo() {
    const ws = worksites.find((w) => w.id === worksiteId);
    const txt =
      `✅ Refeições - ${ws ? ws.name : "Obra"}\n` +
      `📅 Data: ${dateBRFromISO(mealDate)}\n` +
      `🍽 Almoço: ${draftLunch.size} (salvo: ${counts.savedL})\n` +
      `🌙 Janta: ${draftDinner.size} (salvo: ${counts.savedD})\n` +
      (cutLunch || cutDinner ? `⏱ Limites: Almoço ${cutLunch || "-"} • Janta ${cutDinner || "-"}\n` : "");

    try {
      await navigator.clipboard.writeText(txt);
      setInfo("Resumo copiado.");
    } catch {
      setInfo("Não consegui copiar automaticamente. Selecione e copie manualmente.");
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await supabase.auth.signOut();
      window.location.href = "/";
    } finally {
      setBusy(false);
    }
  }

  const headerRightDate = dateBRFromISO(mealDate);

  // Botões de ação (sempre no rodapé, largura total)
  const saveLabel =
    viewShift === "LUNCH"
      ? `Salvar Almoço (${draftLunch.size})`
      : viewShift === "DINNER"
      ? `Salvar Janta (${draftDinner.size})`
      : `Salvar (Almoço ${draftLunch.size} • Janta ${draftDinner.size})`;

  const cancelLabel =
    viewShift === "LUNCH" ? "Cancelar Almoço" : viewShift === "DINNER" ? "Cancelar Janta" : "Cancelar (Almoço/Janta)";

  async function saveAction() {
    if (viewShift === "LUNCH") return saveShift("LUNCH");
    if (viewShift === "DINNER") return saveShift("DINNER");
    // BOTH: salva os dois
    await saveShift("LUNCH");
    await saveShift("DINNER");
  }

  async function cancelAction() {
    if (viewShift === "LUNCH") return cancelShift("LUNCH");
    if (viewShift === "DINNER") return cancelShift("DINNER");
    // BOTH: cancela os dois
    await cancelShift("LUNCH");
    await cancelShift("DINNER");
  }

  if (loading) {
    return (
      <div className="page-root">
        <div className="page-container">
          <div className="section-card">Carregando…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root" style={{ paddingBottom: 240 }}>
      <div className="page-container">
        <header className="page-header" style={{ alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 40, height: 40, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div>
              <div className="brand-text-main">Refeições</div>
              <div className="brand-text-sub">Marcar • Conferir • Salvar</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.pill}>{headerRightDate}</div>
            <button type="button" style={{ ...styles.pill, cursor: "pointer" }} onClick={handleSignOut} disabled={busy}>
              Sair
            </button>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">Escolha a obra, marque rápido e no final confira o total antes de salvar.</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--gp-muted-soft)" }}>
              Logado: {userEmail || "-"}
            </div>
          </div>

          {error ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#991b1b",
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          {info ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#166534",
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {info}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra</label>
              <select
                style={styles.input}
                value={worksiteId}
                onChange={(e) => setWorksiteId(e.target.value)}
                disabled={busy}
              >
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.city ? ` - ${w.city}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input
                style={styles.input}
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                disabled={busy}
              />
              <div style={styles.hint}>Padrão: abre Almoço até 11h, depois Janta.</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Buscar</label>
              <input
                style={styles.input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome do funcionário..."
                disabled={busy}
              />
              <div style={styles.hint}>Dica: marque e, se quiser, ative “Mostrar só marcados”.</div>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(viewShift === "LUNCH")} onClick={() => setViewShift("LUNCH")} disabled={busy}>
                  Almoço
                </button>
                <button type="button" style={segBtnStyle(viewShift === "DINNER")} onClick={() => setViewShift("DINNER")} disabled={busy}>
                  Janta
                </button>
                <button type="button" style={segBtnStyle(viewShift === "BOTH")} onClick={() => setViewShift("BOTH")} disabled={busy}>
                  Ambos
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
                Mostrar só marcados
              </label>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 13, color: "#0f172a", fontWeight: 800 }}>
                {cutLunch || cutDinner ? (
                  <>
                    Limites: <span style={{ color: "#166534" }}>Almoço {cutLunch || "-"}</span> •{" "}
                    <span style={{ color: "#1d4ed8" }}>Janta {cutDinner || "-"}</span>
                    {!allowAfter ? <span style={{ color: "var(--gp-muted-soft)", fontWeight: 700 }}> • trava após limite</span> : null}
                  </>
                ) : (
                  <span style={{ color: "var(--gp-muted-soft)", fontWeight: 700 }}>Sem limites carregados (contrato).</span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={{ ...styles.pill, cursor: "pointer" }} onClick={copyYesterday} disabled={busy}>
                  Copiar ontem
                </button>
                <button type="button" style={{ ...styles.pill, cursor: "pointer" }} onClick={restoreSaved} disabled={busy}>
                  Restaurar salvo
                </button>
                <button type="button" style={{ ...styles.pill, cursor: "pointer" }} onClick={clearDraft} disabled={busy}>
                  Limpar
                </button>
              </div>
            </div>

            <div style={{ gridColumn: "span 12", marginTop: 6, fontSize: 13, color: "var(--gp-muted-soft)" }}>
              Agora: <b>Almoço</b> {counts.draftL} • <b>Janta</b> {counts.draftD} | Salvo: <b>Almoço</b> {counts.savedL} • <b>Janta</b>{" "}
              {counts.savedD}
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 14 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Funcionários</div>
              <div className="section-subtitle">Toque no nome para marcar/desmarcar no turno selecionado.</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {filteredEmployees.map((emp) => {
              const isFav = favorites.has(emp.id);

              const selected =
                viewShift === "LUNCH" ? draftLunch.has(emp.id) : viewShift === "DINNER" ? draftDinner.has(emp.id) : draftLunch.has(emp.id) || draftDinner.has(emp.id);

              const tone: MealShift = viewShift === "DINNER" ? "DINNER" : "LUNCH";

              return (
                <div
                  key={emp.id}
                  style={employeeRowStyle(selected, tone)}
                  onClick={() => toggleEmployee(emp.id)}
                  role="button"
                  aria-label={`Marcar ${emp.full_name}`}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {emp.full_name}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isFav ? (
                      <span style={{ borderRadius: 999, border: "1px solid #fed7aa", background: "#fff7ed", color: "#9a3412", fontWeight: 900, fontSize: 12, padding: "6px 10px" }}>
                        favorito
                      </span>
                    ) : null}

                    <span
                      style={{
                        borderRadius: 999,
                        border: selected ? "1px solid #cbd5e1" : "1px solid #e5e7eb",
                        background: selected ? "#f8fafc" : "#fff",
                        fontWeight: 900,
                        fontSize: 13,
                        padding: "8px 12px",
                        color: "#0f172a",
                      }}
                    >
                      {selected ? "✓ Marcado" : "+ Marcar"}
                    </span>
                  </div>
                </div>
              );
            })}

            {!filteredEmployees.length ? (
              <div style={{ borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", padding: 14, color: "var(--gp-muted-soft)", fontWeight: 700 }}>
                Nenhum funcionário encontrado.
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* AÇÕES FIXAS NO RODAPÉ */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(255,255,255,0.96)",
          borderTop: "1px solid #e5e7eb",
          padding: "12px 12px",
          backdropFilter: "blur(6px)",
        }}
      >
        <div style={{ maxWidth: 920, margin: "0 auto", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={{ borderRadius: 14, border: "1px solid #bbf7d0", background: "#f0fdf4", padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", color: "var(--gp-muted)", textTransform: "uppercase" }}>Almoço</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{draftLunch.size}</div>
              <div style={{ fontSize: 12, color: "#14532d", fontWeight: 800 }}>
                salvo: {savedLunch.size + savedVisitorsLunch}
              </div>
            </div>

            <div style={{ borderRadius: 14, border: "1px solid #bfdbfe", background: "#eff6ff", padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.08em", color: "var(--gp-muted)", textTransform: "uppercase" }}>Janta</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#0f172a" }}>{draftDinner.size}</div>
              <div style={{ fontSize: 12, color: "#1e40af", fontWeight: 800 }}>
                salvo: {savedDinner.size + savedVisitorsDinner}
              </div>
            </div>
          </div>

          <button type="button" style={styles.btnPrimary} onClick={saveAction} disabled={busy || !worksiteId}>
            {busy ? "Aguarde..." : saveLabel}
          </button>

          <button type="button" style={styles.btnDanger} onClick={cancelAction} disabled={busy || !worksiteId}>
            {cancelLabel}
          </button>

          <button type="button" style={styles.btnGhost} onClick={copyResumo} disabled={busy}>
            Copiar resumo
          </button>
        </div>
      </div>
    </div>
  );
}

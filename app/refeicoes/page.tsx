// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type Mode = Shift | "AMBOS";

type Worksite = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type Contract = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  start_date: string | null;
  end_date: string | null;
  cutoff_lunch: string | null; // time
  cutoff_dinner: string | null; // time
  allow_after_cutoff: boolean | null;
  price_lunch: number | null;
  price_dinner: number | null;
};

type Employee = {
  id: string;
  full_name: string;
  active: boolean | null;
  is_third_party: boolean | null;
};

type SavedSnapshot = {
  orderId: string | null;
  employeeIds: string[];
  visitors: string[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatBRFromISO(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isSameISODate(a: string, b: string) {
  return a === b;
}

function addDaysISO(iso: string, delta: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function timeHHMM(t: string | null) {
  if (!t) return "--:--";
  const parts = String(t).split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return String(t);
}

function buildCutoffAtISO(mealDateISO: string, cutoffTime: string | null) {
  if (!cutoffTime) return null;
  const [y, m, d] = mealDateISO.split("-").map(Number);
  const parts = String(cutoffTime).split(":").map((x) => Number(x));
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  const dt = new Date(y, m - 1, d, hh, mm, ss); // local
  return dt.toISOString();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr));
}

function segBtnStyle(active: boolean, tone: "neutral" | "lunch" | "dinner"): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: "8px 12px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    lineHeight: 1,
    userSelect: "none",
  };

  if (!active) return base;

  if (tone === "lunch") {
    return { ...base, border: "1px solid #86efac", background: "#ecfdf5", color: "#166534" };
  }
  if (tone === "dinner") {
    return { ...base, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8" };
  }
  return { ...base, border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a" };
}

function bigBtnStyle(kind: "primaryLunch" | "primaryDinner" | "danger" | "ghost", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    width: "100%",
    borderRadius: 14,
    padding: "14px 14px",
    fontSize: 16,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    border: "1px solid transparent",
  };

  if (kind === "primaryLunch") {
    return {
      ...base,
      background: "#22c55e",
      color: "#fff",
      borderColor: "#16a34a",
      boxShadow: "0 12px 26px rgba(34, 197, 94, 0.18)",
    };
  }
  if (kind === "primaryDinner") {
    return {
      ...base,
      background: "#2563eb",
      color: "#fff",
      borderColor: "#1d4ed8",
      boxShadow: "0 12px 26px rgba(37, 99, 235, 0.18)",
    };
  }
  if (kind === "danger") {
    return { ...base, background: "#fff", color: "#991b1b", borderColor: "#fecaca" };
  }
  return { ...base, background: "#fff", color: "#0f172a", borderColor: "#e5e7eb" };
}

export default function RefeicoesPage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string>("");

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [contract, setContract] = useState<Contract | null>(null);
  const [canOverrideCutoff, setCanOverrideCutoff] = useState<boolean>(false);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);

  const [mode, setMode] = useState<Mode>("ALMOCO");

  const [selectedLunch, setSelectedLunch] = useState<Set<string>>(new Set());
  const [selectedDinner, setSelectedDinner] = useState<Set<string>>(new Set());
  const [visitorsLunch, setVisitorsLunch] = useState<string[]>([]);
  const [visitorsDinner, setVisitorsDinner] = useState<string[]>([]);

  const [saved, setSaved] = useState<Record<Shift, SavedSnapshot>>({
    ALMOCO: { orderId: null, employeeIds: [], visitors: [] },
    JANTA: { orderId: null, employeeIds: [], visitors: [] },
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });
  const [canceling, setCanceling] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

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
    select: {
      width: "100%",
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      padding: "12px 12px",
      fontSize: 16,
      outline: "none",
      background: "#ffffff",
      color: "var(--gp-text)",
    },
    hint: { fontSize: 12, color: "var(--gp-muted-soft)" },
  };

  const totals = useMemo(() => {
    const lunch = selectedLunch.size + visitorsLunch.length;
    const dinner = selectedDinner.size + visitorsDinner.length;
    return { lunch, dinner, all: lunch + dinner };
  }, [selectedLunch, selectedDinner, visitorsLunch, visitorsDinner]);

  const savedCounts = useMemo(() => {
    const l = (saved.ALMOCO.employeeIds?.length || 0) + (saved.ALMOCO.visitors?.length || 0);
    const j = (saved.JANTA.employeeIds?.length || 0) + (saved.JANTA.visitors?.length || 0);
    return { lunch: l, dinner: j };
  }, [saved]);

  const limits = useMemo(() => {
    const lunch = timeHHMM(contract?.cutoff_lunch ?? null);
    const dinner = timeHHMM(contract?.cutoff_dinner ?? null);
    return { lunch, dinner };
  }, [contract]);

  // default mode: almoço até 11h, depois janta (somente se a data for hoje)
  useEffect(() => {
    const today = isoTodayLocal();
    if (!isSameISODate(mealDate, today)) {
      setMode("ALMOCO");
      return;
    }
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();
    const after11 = hh > 11 || (hh === 11 && mm >= 0);
    setMode(after11 ? "JANTA" : "ALMOCO");
  }, [mealDate]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    setUserEmail(u?.email || "");
    return u?.id || null;
  }

  async function loadWorksites() {
    const { data, error } = await supabase
      .from("meal_worksites")
      .select("id,name,city,active")
      .eq("active", true)
      .order("name", { ascending: true });

    if (error) throw error;
    const rows = (data || []) as Worksite[];
    setWorksites(rows);
    if (!worksiteId && rows[0]?.id) setWorksiteId(rows[0].id);
  }

  async function loadEmployeesAndFavorites(wid: string) {
    const [empRes, favRes] = await Promise.all([
      supabase.from("meal_employees").select("id,full_name,active,is_third_party").eq("active", true).order("full_name"),
      supabase.from("meal_worksite_favorites").select("employee_id").eq("worksite_id", wid),
    ]);

    if (empRes.error) throw empRes.error;
    if (favRes.error) throw favRes.error;

    const emps = (empRes.data || []) as Employee[];
    const favIds = new Set<string>((favRes.data || []).map((r: any) => String(r.employee_id)));

    // favoritos primeiro
    emps.sort((a, b) => {
      const af = favIds.has(a.id) ? 1 : 0;
      const bf = favIds.has(b.id) ? 1 : 0;
      if (af !== bf) return bf - af;
      return a.full_name.localeCompare(b.full_name, "pt-BR");
    });

    setFavoriteIds(favIds);
    setEmployees(emps);
  }

  async function loadContract(wid: string, dateISO: string) {
    const q = supabase
      .from("meal_contracts")
      .select("id,worksite_id,restaurant_id,start_date,end_date,cutoff_lunch,cutoff_dinner,allow_after_cutoff,price_lunch,price_dinner")
      .eq("worksite_id", wid)
      .lte("start_date", dateISO)
      .order("start_date", { ascending: false })
      .limit(1);

    const { data, error } = await q.or(`end_date.is.null,end_date.gte.${dateISO}`).maybeSingle();
    if (error) throw error;

    setContract((data as any) ?? null);
    return (data as any) as Contract | null;
  }

  async function loadOverride(wid: string, userId: string | null) {
    if (!userId) {
      setCanOverrideCutoff(false);
      return;
    }
    const { data, error } = await supabase
      .from("meal_worksite_members")
      .select("can_override_cutoff")
      .eq("worksite_id", wid)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      setCanOverrideCutoff(false);
      return;
    }
    setCanOverrideCutoff(Boolean((data as any)?.can_override_cutoff));
  }

  async function fetchSavedForShift(wid: string, rid: string, dateISO: string, shift: Shift): Promise<SavedSnapshot> {
    const { data: order, error: e1 } = await supabase
      .from("meal_orders")
      .select("id")
      .eq("worksite_id", wid)
      .eq("restaurant_id", rid)
      .eq("meal_date", dateISO)
      .eq("shift", shift)
      .limit(1)
      .maybeSingle();

    if (e1) throw e1;

    const orderId = (order as any)?.id ? String((order as any).id) : null;
    if (!orderId) return { orderId: null, employeeIds: [], visitors: [] };

    const { data: lines, error: e2 } = await supabase
      .from("meal_order_lines")
      .select("employee_id,visitor_name,included")
      .eq("meal_order_id", orderId)
      .eq("included", true);

    if (e2) throw e2;

    const empIds = uniq(
      (lines || [])
        .map((r: any) => (r.employee_id ? String(r.employee_id) : ""))
        .filter(Boolean)
    );
    const visitors = uniq(
      (lines || [])
        .map((r: any) => (r.visitor_name ? String(r.visitor_name) : ""))
        .filter(Boolean)
    );

    return { orderId, employeeIds: empIds, visitors };
  }

  async function refreshSaved() {
    setError(null);
    setOkMsg(null);

    if (!worksiteId || !contract?.restaurant_id) {
      setSaved({
        ALMOCO: { orderId: null, employeeIds: [], visitors: [] },
        JANTA: { orderId: null, employeeIds: [], visitors: [] },
      });
      return;
    }

    const rid = contract.restaurant_id;

    const [l, j] = await Promise.all([
      fetchSavedForShift(worksiteId, rid, mealDate, "ALMOCO"),
      fetchSavedForShift(worksiteId, rid, mealDate, "JANTA"),
    ]);

    setSaved({ ALMOCO: l, JANTA: j });
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const userId = await loadUser();

      // ✅ garante que não entra sem sessão
      if (!userId) {
        router.replace("/");
        return;
      }

      await loadWorksites();
      if (worksiteId) {
        await loadOverride(worksiteId, userId);
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // quando muda obra/data: recarrega contrato, favoritos, funcionários e saved
  useEffect(() => {
    (async () => {
      if (!worksiteId) return;
      setLoading(true);
      setError(null);
      setOkMsg(null);

      try {
        const { data } = await supabase.auth.getUser();
        const userId = data?.user?.id ?? null;

        // se perdeu sessão, volta pro login
        if (!userId) {
          router.replace("/");
          return;
        }

        await loadEmployeesAndFavorites(worksiteId);
        const c = await loadContract(worksiteId, mealDate);
        await loadOverride(worksiteId, userId);

        // reset seleção local (não apaga saved)
        setSelectedLunch(new Set());
        setSelectedDinner(new Set());
        setVisitorsLunch([]);
        setVisitorsDinner([]);

        if (c?.restaurant_id) {
          await refreshSaved();
        } else {
          setSaved({
            ALMOCO: { orderId: null, employeeIds: [], visitors: [] },
            JANTA: { orderId: null, employeeIds: [], visitors: [] },
          });
        }
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar dados.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, mealDate]);

  function toggleEmployee(shift: Shift, employeeId: string) {
    if (shift === "ALMOCO") {
      setSelectedLunch((prev) => {
        const n = new Set(prev);
        if (n.has(employeeId)) n.delete(employeeId);
        else n.add(employeeId);
        return n;
      });
    } else {
      setSelectedDinner((prev) => {
        const n = new Set(prev);
        if (n.has(employeeId)) n.delete(employeeId);
        else n.add(employeeId);
        return n;
      });
    }
  }

  function clearSelection(target: Mode) {
    if (target === "ALMOCO") {
      setSelectedLunch(new Set());
      setVisitorsLunch([]);
      return;
    }
    if (target === "JANTA") {
      setSelectedDinner(new Set());
      setVisitorsDinner([]);
      return;
    }
    setSelectedLunch(new Set());
    setSelectedDinner(new Set());
    setVisitorsLunch([]);
    setVisitorsDinner([]);
  }

  function restoreSaved(target: Mode) {
    if (target === "ALMOCO") {
      setSelectedLunch(new Set(saved.ALMOCO.employeeIds || []));
      setVisitorsLunch(saved.ALMOCO.visitors || []);
      return;
    }
    if (target === "JANTA") {
      setSelectedDinner(new Set(saved.JANTA.employeeIds || []));
      setVisitorsDinner(saved.JANTA.visitors || []);
      return;
    }
    setSelectedLunch(new Set(saved.ALMOCO.employeeIds || []));
    setVisitorsLunch(saved.ALMOCO.visitors || []);
    setSelectedDinner(new Set(saved.JANTA.employeeIds || []));
    setVisitorsDinner(saved.JANTA.visitors || []);
  }

  async function copyYesterday(target: Mode) {
    setError(null);
    setOkMsg(null);

    if (!worksiteId || !contract?.restaurant_id) {
      setError("Sem contrato ativo para esta obra (restaurant_id não encontrado).");
      return;
    }

    const rid = contract.restaurant_id;
    const y = addDaysISO(mealDate, -1);

    try {
      if (target === "ALMOCO") {
        const snap = await fetchSavedForShift(worksiteId, rid, y, "ALMOCO");
        setSelectedLunch(new Set(snap.employeeIds || []));
        setVisitorsLunch(snap.visitors || []);
        setOkMsg(`Copiado de ontem (${formatBRFromISO(y)}) para ALMOÇO.`);
        return;
      }
      if (target === "JANTA") {
        const snap = await fetchSavedForShift(worksiteId, rid, y, "JANTA");
        setSelectedDinner(new Set(snap.employeeIds || []));
        setVisitorsDinner(snap.visitors || []);
        setOkMsg(`Copiado de ontem (${formatBRFromISO(y)}) para JANTA.`);
        return;
      }

      const [l, j] = await Promise.all([
        fetchSavedForShift(worksiteId, rid, y, "ALMOCO"),
        fetchSavedForShift(worksiteId, rid, y, "JANTA"),
      ]);

      setSelectedLunch(new Set(l.employeeIds || []));
      setVisitorsLunch(l.visitors || []);
      setSelectedDinner(new Set(j.employeeIds || []));
      setVisitorsDinner(j.visitors || []);
      setOkMsg(`Copiado de ontem (${formatBRFromISO(y)}) para ALMOÇO + JANTA.`);
    } catch (e: any) {
      setError(e?.message || "Falha ao copiar ontem.");
    }
  }

  async function addVisitor(targetShift: Shift) {
    const name = window.prompt("Nome do visitante (sem cadastro):")?.trim();
    if (!name) return;

    if (targetShift === "ALMOCO") setVisitorsLunch((p) => uniq([...p, name]));
    else setVisitorsDinner((p) => uniq([...p, name]));
  }

  async function saveShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!worksiteId) return setError("Selecione a obra."), undefined;
    if (!contract?.restaurant_id) return setError("Sem contrato ativo para esta obra."), undefined;

    const rid = contract.restaurant_id;

    const selectedIds = shift === "ALMOCO" ? Array.from(selectedLunch) : Array.from(selectedDinner);
    const visitors = shift === "ALMOCO" ? visitorsLunch : visitorsDinner;

    const total = selectedIds.length + visitors.length;
    if (total <= 0) return setError("Nenhuma refeição marcada para salvar."), undefined;

    setSaving((p) => ({ ...p, [shift]: true }));

    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud?.user?.id ?? null;
      if (!userId) {
        router.replace("/");
        return;
      }

      const cutoffTime = shift === "ALMOCO" ? contract.cutoff_lunch : contract.cutoff_dinner;
      const cutoffAtISO = buildCutoffAtISO(mealDate, cutoffTime);
      const allowAfter = Boolean(contract.allow_after_cutoff);
      const now = new Date();

      if (cutoffAtISO && !allowAfter && !canOverrideCutoff) {
        const cutoffAt = new Date(cutoffAtISO);
        if (isSameISODate(mealDate, isoTodayLocal()) && now.getTime() > cutoffAt.getTime()) {
          throw new Error(`Fora do horário limite (${shift === "ALMOCO" ? limits.lunch : limits.dinner}).`);
        }
      }

      const { data: existing, error: e1 } = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", worksiteId)
        .eq("restaurant_id", rid)
        .eq("meal_date", mealDate)
        .eq("shift", shift)
        .limit(1)
        .maybeSingle();

      if (e1) throw e1;

      let orderId = (existing as any)?.id ? String((existing as any).id) : null;

      if (!orderId) {
        const ins = await supabase
          .from("meal_orders")
          .insert({
            worksite_id: worksiteId,
            restaurant_id: rid,
            meal_date: mealDate,
            shift,
            status: "DRAFT",
            cutoff_at: cutoffAtISO,
            created_by: userId,
            updated_by: userId,
            order_date: mealDate,
          })
          .select("id")
          .single();

        if (ins.error) throw ins.error;
        orderId = String((ins.data as any)?.id);
      } else {
        const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
        if (del.error) throw del.error;

        const up = await supabase
          .from("meal_orders")
          .update({ cutoff_at: cutoffAtISO, updated_by: userId })
          .eq("id", orderId);

        if (up.error) throw up.error;
      }

      const rows: any[] = [];
      for (const eid of selectedIds) {
        rows.push({ meal_order_id: orderId, employee_id: eid, included: true, created_by: userId, updated_by: userId });
      }
      for (const v of visitors) {
        rows.push({ meal_order_id: orderId, visitor_name: v, included: true, created_by: userId, updated_by: userId });
      }

      const insLines = await supabase.from("meal_order_lines").insert(rows);
      if (insLines.error) throw insLines.error;

      await refreshSaved();
      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} salvo com sucesso (${total}).`);
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setSaving((p) => ({ ...p, [shift]: false }));
    }
  }

  async function cancelShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!worksiteId || !contract?.restaurant_id) {
      setError("Sem contrato ativo para esta obra.");
      return;
    }

    const rid = contract.restaurant_id;
    setCanceling((p) => ({ ...p, [shift]: true }));

    try {
      let orderId = saved[shift]?.orderId || null;
      if (!orderId) {
        const snap = await fetchSavedForShift(worksiteId, rid, mealDate, shift);
        orderId = snap.orderId;
      }
      if (!orderId) {
        setOkMsg("Nada salvo para cancelar.");
        return;
      }

      const delLines = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
      if (delLines.error) throw delLines.error;

      const delOrder = await supabase.from("meal_orders").delete().eq("id", orderId);
      if (delOrder.error) throw delOrder.error;

      await refreshSaved();
      clearSelection(shift);

      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado (apagado).`);
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setCanceling((p) => ({ ...p, [shift]: false }));
    }
  }

  async function copyResumo() {
    const ws = worksites.find((w) => w.id === worksiteId);
    const wsName = ws ? `${ws.name}${ws.city ? " - " + ws.city : ""}` : "-";

    const lunchNames = employees.filter((e) => selectedLunch.has(e.id)).map((e) => e.full_name);
    const dinnerNames = employees.filter((e) => selectedDinner.has(e.id)).map((e) => e.full_name);

    const msg =
      `📍 Obra: ${wsName}\n` +
      `📅 Data: ${formatBRFromISO(mealDate)}\n\n` +
      `🍽️ Almoço (${totals.lunch}):\n` +
      `${[...lunchNames, ...visitorsLunch].map((x) => `- ${x}`).join("\n") || "-"}\n\n` +
      `🌙 Janta (${totals.dinner}):\n` +
      `${[...dinnerNames, ...visitorsDinner].map((x) => `- ${x}`).join("\n") || "-"}`;

    try {
      await navigator.clipboard.writeText(msg);
      setOkMsg("Resumo copiado.");
    } catch {
      setError("Não consegui copiar automaticamente (permita clipboard).");
    }
  }

  const filteredEmployees = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = employees;

    if (q) list = list.filter((e) => e.full_name.toLowerCase().includes(q));
    if (!onlyMarked) return list;

    return list.filter((e) => {
      if (mode === "ALMOCO") return selectedLunch.has(e.id);
      if (mode === "JANTA") return selectedDinner.has(e.id);
      return selectedLunch.has(e.id) || selectedDinner.has(e.id);
    });
  }, [employees, query, onlyMarked, mode, selectedLunch, selectedDinner]);

  const headerDatePill = useMemo(() => formatBRFromISO(mealDate), [mealDate]);

  const bottomTitle = useMemo(() => {
    if (mode === "ALMOCO") return `Salvar Almoço (${totals.lunch})`;
    if (mode === "JANTA") return `Salvar Janta (${totals.dinner})`;
    return `Salvar (Almoço ${totals.lunch} • Janta ${totals.dinner})`;
  }, [mode, totals]);

  const bottomSaveDisabled = useMemo(() => {
    if (mode === "ALMOCO") return totals.lunch <= 0 || saving.ALMOCO;
    if (mode === "JANTA") return totals.dinner <= 0 || saving.JANTA;
    return (totals.lunch <= 0 && totals.dinner <= 0) || saving.ALMOCO || saving.JANTA;
  }, [mode, totals, saving]);

  async function handleBottomSave() {
    if (mode === "ALMOCO") return saveShift("ALMOCO");
    if (mode === "JANTA") return saveShift("JANTA");
    if (totals.lunch > 0) await saveShift("ALMOCO");
    if (totals.dinner > 0) await saveShift("JANTA");
  }

  async function handleBottomCancel() {
    if (mode === "ALMOCO") return cancelShift("ALMOCO");
    if (mode === "JANTA") return cancelShift("JANTA");
    await cancelShift("ALMOCO");
    await cancelShift("JANTA");
  }

  const bottomCancelLabel = useMemo(() => {
    if (mode === "ALMOCO") return `Cancelar Almoço (salvo: ${savedCounts.lunch})`;
    if (mode === "JANTA") return `Cancelar Janta (salvo: ${savedCounts.dinner})`;
    return `Cancelar (salvos: Almoço ${savedCounts.lunch} • Janta ${savedCounts.dinner})`;
  }, [mode, savedCounts]);

  const bottomCancelDisabled = useMemo(() => {
    if (mode === "ALMOCO") return canceling.ALMOCO || savedCounts.lunch <= 0;
    if (mode === "JANTA") return canceling.JANTA || savedCounts.dinner <= 0;
    return (savedCounts.lunch <= 0 && savedCounts.dinner <= 0) || canceling.ALMOCO || canceling.JANTA;
  }, [mode, canceling, savedCounts]);

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 260 }}>
        {/* ✅ HEADER: logo maior e centralizado; logado aqui em cima */}
        <header className="page-header" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{ width: 54, height: 54, objectFit: "contain", border: "none", background: "transparent" }}
          />

          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main" style={{ lineHeight: 1.05 }}>
              Refeições
            </div>
            <div className="brand-text-sub">Marcar • Conferir • Salvar</div>
            {userEmail ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>Logado: {userEmail}</div>
            ) : null}
          </div>

          <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <div
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 800,
              }}
              title="Data selecionada"
            >
              {headerDatePill}
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Sair
            </button>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="section-title">Marcação</div>
              {/* ✅ removido o texto grande “Escolha a obra...” */}
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

          {okMsg ? (
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
              {okMsg}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra</label>
              <select
                style={styles.select}
                value={worksiteId}
                onChange={(e) => setWorksiteId(e.target.value)}
                disabled={loading || worksites.length === 0}
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
                disabled={loading}
              />
              <div style={{ marginTop: 6, ...styles.hint }}>Padrão: abre Almoço até 11h, depois Janta.</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Buscar</label>
              <input
                style={styles.input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome do funcionário..."
              />
              <div style={{ marginTop: 6, ...styles.hint }}>Dica: marque e use “Mostrar só marcados”.</div>
            </div>

            <div
              style={{
                gridColumn: "span 12",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(mode === "ALMOCO", "lunch")} onClick={() => setMode("ALMOCO")}>
                  Almoço
                </button>
                <button type="button" style={segBtnStyle(mode === "JANTA", "dinner")} onClick={() => setMode("JANTA")}>
                  Janta
                </button>
                <button type="button" style={segBtnStyle(mode === "AMBOS", "neutral")} onClick={() => setMode("AMBOS")}>
                  Ambos
                </button>

                <div style={{ marginLeft: 8, fontSize: 12, color: "var(--gp-muted-soft)", alignSelf: "center" }}>
                  Limites: Almoço <b>{limits.lunch}</b> • Janta <b>{limits.dinner}</b>
                  {canOverrideCutoff ? <span style={{ marginLeft: 8 }}>(override)</span> : null}
                </div>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800 }}>
                <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
                Mostrar só marcados
              </label>
            </div>

            <div
              style={{
                gridColumn: "span 12",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => copyYesterday(mode)} disabled={loading}>
                  Copiar ontem
                </button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => restoreSaved(mode)} disabled={loading}>
                  Restaurar salvo
                </button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => clearSelection(mode)} disabled={loading}>
                  Limpar
                </button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={copyResumo} disabled={loading}>
                  Copiar resumo
                </button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div
                  style={{
                    borderRadius: 999,
                    border: "1px solid #86efac",
                    background: "#ecfdf5",
                    color: "#166534",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                  title="Marcados agora / Salvos no banco"
                >
                  Almoço: {totals.lunch} (salvo: {savedCounts.lunch})
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    border: "1px solid #93c5fd",
                    background: "#eff6ff",
                    color: "#1d4ed8",
                    padding: "6px 10px",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                  title="Marcados agora / Salvos no banco"
                >
                  Janta: {totals.dinner} (salvo: {savedCounts.dinner})
                </div>
              </div>
            </div>

            {!contract ? (
              <div
                style={{
                  gridColumn: "span 12",
                  borderRadius: 14,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  padding: "10px 12px",
                  color: "#92400e",
                  fontSize: 13,
                }}
              >
                ⚠️ Nenhum contrato vigente encontrado para esta obra na data selecionada. Você pode marcar, mas não vai conseguir salvar.
              </div>
            ) : null}
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Funcionários</div>
              <div className="section-subtitle">Toque para marcar/desmarcar no turno selecionado.</div>
            </div>
            <button
              type="button"
              onClick={() => addVisitor(mode === "JANTA" ? "JANTA" : "ALMOCO")}
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer",
              }}
              title="Adicionar visitante sem cadastro"
            >
              + Pessoa
            </button>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {filteredEmployees.map((e) => {
              const lunchOn = selectedLunch.has(e.id);
              const dinnerOn = selectedDinner.has(e.id);
              const fav = favoriteIds.has(e.id);

              const card: CSSProperties = {
                borderRadius: 16,
                border: "1px solid #eef2f7",
                background: "#fff",
                padding: 12,
              };

              const nameStyle: CSSProperties = {
                fontSize: 14,
                fontWeight: 900,
                color: "#0f172a",
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              };

              const tag: CSSProperties = {
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 900,
                border: "1px solid #fed7aa",
                background: "#fff7ed",
                color: "#9a3412",
              };

              const actionBtn = (active: boolean, tone: Shift): CSSProperties => {
                if (tone === "ALMOCO") {
                  return {
                    width: "100%",
                    borderRadius: 14,
                    border: `1px solid ${active ? "#86efac" : "#d1fae5"}`,
                    background: active ? "#ecfdf5" : "#f0fdf4",
                    color: "#166534",
                    padding: "14px 14px",
                    fontSize: 16,
                    fontWeight: 900,
                    cursor: "pointer",
                  };
                }
                return {
                  width: "100%",
                  borderRadius: 14,
                  border: `1px solid ${active ? "#93c5fd" : "#dbeafe"}`,
                  background: active ? "#eff6ff" : "#f8fbff",
                  color: "#1d4ed8",
                  padding: "14px 14px",
                  fontSize: 16,
                  fontWeight: 900,
                  cursor: "pointer",
                };
              };

              return (
                <div key={e.id} style={card}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={nameStyle}>{e.full_name}</div>
                    {fav ? <div style={tag}>favorito</div> : null}
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {mode === "AMBOS" ? (
                      <>
                        <button type="button" style={actionBtn(lunchOn, "ALMOCO")} onClick={() => toggleEmployee("ALMOCO", e.id)}>
                          {lunchOn ? "✓ Almoço" : "+ Almoço"}
                        </button>
                        <button type="button" style={actionBtn(dinnerOn, "JANTA")} onClick={() => toggleEmployee("JANTA", e.id)}>
                          {dinnerOn ? "✓ Janta" : "+ Janta"}
                        </button>
                      </>
                    ) : mode === "ALMOCO" ? (
                      <button type="button" style={actionBtn(lunchOn, "ALMOCO")} onClick={() => toggleEmployee("ALMOCO", e.id)}>
                        {lunchOn ? "✓ Almoço" : "+ Almoço"}
                      </button>
                    ) : (
                      <button type="button" style={actionBtn(dinnerOn, "JANTA")} onClick={() => toggleEmployee("JANTA", e.id)}>
                        {dinnerOn ? "✓ Janta" : "+ Janta"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {(visitorsLunch.length > 0 || visitorsDinner.length > 0) ? (
              <div style={{ borderRadius: 16, border: "1px solid #eef2f7", background: "#fff", padding: 12 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    color: "var(--gp-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Pessoas sem cadastro
                </div>

                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {visitorsLunch.map((v) => (
                    <div key={`l-${v}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 800, color: "#166534" }}>🍽️ {v}</div>
                      <button type="button" onClick={() => setVisitorsLunch((p) => p.filter((x) => x !== v))} style={segBtnStyle(false, "neutral")}>
                        Remover
                      </button>
                    </div>
                  ))}
                  {visitorsDinner.map((v) => (
                    <div key={`d-${v}`} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 800, color: "#1d4ed8" }}>🌙 {v}</div>
                      <button type="button" onClick={() => setVisitorsDinner((p) => p.filter((x) => x !== v))} style={segBtnStyle(false, "neutral")}>
                        Remover
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {loading ? <div style={{ marginTop: 12, fontSize: 13, color: "var(--gp-muted-soft)" }}>Carregando…</div> : null}
        </div>
      </div>

      {/* Barra fixa no final */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          padding: "12px 12px calc(12px + env(safe-area-inset-bottom))",
          background: "rgba(255,255,255,0.92)",
          borderTop: "1px solid #eef2f7",
          backdropFilter: "blur(10px)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
              <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.lunch}</div>
              <div style={{ fontSize: 12, color: "#166534" }}>salvo: {savedCounts.lunch} • limite {limits.lunch}</div>
            </div>

            <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
              <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.dinner}</div>
              <div style={{ fontSize: 12, color: "#1d4ed8" }}>salvo: {savedCounts.dinner} • limite {limits.dinner}</div>
            </div>
          </div>

          <button
            type="button"
            style={mode === "JANTA" ? bigBtnStyle("primaryDinner", bottomSaveDisabled) : bigBtnStyle("primaryLunch", bottomSaveDisabled)}
            onClick={handleBottomSave}
            disabled={bottomSaveDisabled || !contract}
          >
            {saving.ALMOCO || saving.JANTA ? "Salvando..." : bottomTitle}
          </button>

          <div style={{ height: 10 }} />

          <button
            type="button"
            style={bigBtnStyle("danger", bottomCancelDisabled)}
            onClick={handleBottomCancel}
            disabled={bottomCancelDisabled || !contract}
          >
            {canceling.ALMOCO || canceling.JANTA ? "Cancelando..." : bottomCancelLabel}
          </button>

          <div style={{ height: 10 }} />

          <button type="button" style={bigBtnStyle("ghost", false)} onClick={copyResumo}>
            Copiar resumo
          </button>
        </div>
      </div>
    </div>
  );
}

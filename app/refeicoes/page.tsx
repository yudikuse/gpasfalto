"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type Mode = Shift | "AMBOS";

type Worksite = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type Requester = {
  id: string;
  name: string;
  active: boolean | null;
};

type Restaurant = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type RestaurantContract = {
  id: string;
  restaurant_id: string;
  start_date: string | null;
  end_date: string | null;
  cutoff_lunch: string | null;
  cutoff_dinner: string | null;
  allow_after_cutoff: boolean | null;
  price_lunch: number | null;
  price_dinner: number | null;
};

type Employee = {
  id: string;
  full_name: string;
  role: string | null;
  active: boolean | null;
  is_third_party: boolean | null;
};

type SavedSnapshot = {
  orderId: string | null;
  employeeIds: string[];
  visitors: string[];
  confirmedAt: string | null;
};

type LotSummary = {
  orderId: string;
  shift: Shift;
  restaurantId: string;
  restaurantName: string;
  qty: number;
  confirmedAt: string | null;
  status: string | null;
};

const LS_KEY = "meal_requester_access_v1";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoTodayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatBRFromISO(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
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
  const parts = String(cutoffTime).split(":").map((x) => Number(x));
  const hh = pad2(parts[0] ?? 0);
  const mm = pad2(parts[1] ?? 0);
  const ss = pad2(parts[2] ?? 0);
  return `${mealDateISO}T${hh}:${mm}:${ss}-03:00`;
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
  if (tone === "lunch") return { ...base, border: "1px solid #86efac", background: "#ecfdf5", color: "#166534" };
  if (tone === "dinner") return { ...base, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8" };
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
  if (kind === "primaryLunch") return { ...base, background: "#22c55e", color: "#fff", borderColor: "#16a34a", boxShadow: "0 12px 26px rgba(34,197,94,0.18)" };
  if (kind === "primaryDinner") return { ...base, background: "#2563eb", color: "#fff", borderColor: "#1d4ed8", boxShadow: "0 12px 26px rgba(37,99,235,0.18)" };
  if (kind === "danger") return { ...base, background: "#fff", color: "#991b1b", borderColor: "#fecaca" };
  return { ...base, background: "#fff", color: "#0f172a", borderColor: "#e5e7eb" };
}

export default function RefeicoesPage() {
  const [accessReady, setAccessReady] = useState(false);
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [requesters, setRequesters] = useState<Requester[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);

  const [worksiteId, setWorksiteId] = useState("");
  const [requesterId, setRequesterId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");

  const [mealDate, setMealDate] = useState(isoTodayLocal());
  const [restaurantContract, setRestaurantContract] = useState<RestaurantContract | null>(null);

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
    ALMOCO: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null },
    JANTA: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null },
  });
  const [lotSummaries, setLotSummaries] = useState<LotSummary[]>([]);

  const [loading, setLoading] = useState(false);
  const [bootLoaded, setBootLoaded] = useState(false);
  const [saving, setSaving] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });
  const [canceling, setCanceling] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [pendingReopenShift, setPendingReopenShift] = useState<Shift | null>(null);
  const [pendingCancelShift, setPendingCancelShift] = useState<Shift | null>(null);
  const [visitorModal, setVisitorModal] = useState<{ open: boolean; targetShift: Shift; name: string; error: string | null }>({
    open: false,
    targetShift: "ALMOCO",
    name: "",
    error: null,
  });

  const styles: Record<string, CSSProperties> = {
    label: { fontSize: 12, fontWeight: 800, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 },
    input: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
    select: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
    hint: { fontSize: 12, color: "var(--gp-muted-soft)" },
  };

  const currentRequester = useMemo(() => requesters.find((r) => r.id === requesterId) || null, [requesters, requesterId]);

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
    const lunch = timeHHMM(restaurantContract?.cutoff_lunch ?? null);
    const dinner = timeHHMM(restaurantContract?.cutoff_dinner ?? null);
    return { lunch, dinner };
  }, [restaurantContract]);

  const loadHints = useMemo(
    () => ({
      noWorksites: bootLoaded && worksites.length === 0,
      noRestaurants: bootLoaded && restaurants.length === 0,
      noRequesters: bootLoaded && !!worksiteId && requesters.length === 0,
      noEmployees: bootLoaded && !!worksiteId && employees.length === 0,
    }),
    [bootLoaded, worksites.length, restaurants.length, requesters.length, employees.length, worksiteId]
  );

  useEffect(() => {
    const today = isoTodayLocal();
    if (mealDate !== today) {
      setMode("ALMOCO");
      return;
    }
    const now = new Date();
    const after11 = now.getHours() > 11 || (now.getHours() === 11 && now.getMinutes() >= 0);
    setMode(after11 ? "JANTA" : "ALMOCO");
  }, [mealDate]);

  function saveAccess(nextWorksiteId: string, nextRequesterId: string) {
    localStorage.setItem(LS_KEY, JSON.stringify({ worksiteId: nextWorksiteId, requesterId: nextRequesterId }));
  }

  function clearAccess() {
    localStorage.removeItem(LS_KEY);
    setAccessReady(false);
    setRequesterId("");
    setOkMsg(null);
    setError(null);
  }

  async function loadWorksites() {
    const { data, error } = await supabase.from("meal_worksites").select("id,name,city,active").eq("active", true).order("name", { ascending: true });
    if (error) throw error;
    const rows = (data || []) as Worksite[];
    setWorksites(rows);
    return rows;
  }

  async function loadRestaurants() {
    const { data, error } = await supabase.from("meal_restaurants").select("id,name,city,active").eq("active", true).order("name", { ascending: true });
    if (error) throw error;
    const rows = (data || []) as Restaurant[];
    setRestaurants(rows);
    setRestaurantId((prev) => prev || rows[0]?.id || "");
    return rows;
  }

  async function loadRequestersForWorksite(wid: string) {
    if (!wid) {
      setRequesters([]);
      setRequesterId("");
      return [];
    }
    const { data, error } = await supabase
      .from("meal_requester_worksites")
      .select("requester_id, meal_requesters!inner(id,name,active)")
      .eq("worksite_id", wid);
    if (error) throw error;

    const rows = (data || []).map((r: any) => r.meal_requesters).filter(Boolean).map((r: any) => ({
      id: String(r.id),
      name: String(r.name),
      active: r.active ?? true,
    })) as Requester[];

    rows.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    setRequesters(rows);
    setRequesterId((prev) => {
      if (prev && rows.some((r) => r.id === prev)) return prev;
      return rows[0]?.id || "";
    });
    return rows;
  }

  async function loadEmployeesAndFavorites(wid: string) {
    const [empRes, favRes] = await Promise.all([
      supabase.from("meal_employees").select("id,full_name,role,active,is_third_party").eq("active", true).order("full_name"),
      supabase.from("meal_worksite_favorites").select("employee_id").eq("worksite_id", wid),
    ]);
    if (empRes.error) throw empRes.error;
    if (favRes.error) throw favRes.error;

    const emps = (empRes.data || []) as Employee[];
    const favIds = new Set<string>((favRes.data || []).map((r: any) => String(r.employee_id)));
    emps.sort((a, b) => {
      const af = favIds.has(a.id) ? 1 : 0;
      const bf = favIds.has(b.id) ? 1 : 0;
      if (af !== bf) return bf - af;
      return a.full_name.localeCompare(b.full_name, "pt-BR");
    });
    setFavoriteIds(favIds);
    setEmployees(emps);
  }

  async function loadRestaurantContract(rid: string, dateISO: string) {
    if (!rid) {
      setRestaurantContract(null);
      return null;
    }
    const { data, error } = await supabase
      .from("meal_contracts")
      .select("id,restaurant_id,start_date,end_date,cutoff_lunch,cutoff_dinner,allow_after_cutoff,price_lunch,price_dinner")
      .eq("restaurant_id", rid)
      .lte("start_date", dateISO)
      .or(`end_date.is.null,end_date.gte.${dateISO}`)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    const row = (data as any) ?? null;
    setRestaurantContract(row);
    return row as RestaurantContract | null;
  }

  async function fetchSavedForShift(wid: string, rid: string, dateISO: string, shift: Shift): Promise<SavedSnapshot> {
    if (!wid || !rid) return { orderId: null, employeeIds: [], visitors: [], confirmedAt: null };

    const { data: order, error: e1 } = await supabase
      .from("meal_orders")
      .select("id,confirmed_at")
      .eq("worksite_id", wid)
      .eq("restaurant_id", rid)
      .eq("meal_date", dateISO)
      .eq("shift", shift)
      .limit(1)
      .maybeSingle();
    if (e1) throw e1;

    const orderId = (order as any)?.id ? String((order as any).id) : null;
    const confirmedAt = (order as any)?.confirmed_at ? String((order as any).confirmed_at) : null;

    if (!orderId) return { orderId: null, employeeIds: [], visitors: [], confirmedAt: null };

    const { data: lines, error: e2 } = await supabase.from("meal_order_lines").select("employee_id,visitor_name,included").eq("meal_order_id", orderId).eq("included", true);
    if (e2) throw e2;

    const employeeIds = uniq((lines || []).map((r: any) => (r.employee_id ? String(r.employee_id) : "")).filter(Boolean));
    const visitors = uniq((lines || []).map((r: any) => (r.visitor_name ? String(r.visitor_name) : "")).filter(Boolean));

    return { orderId, employeeIds, visitors, confirmedAt };
  }

  async function refreshSaved() {
    if (!worksiteId || !restaurantId) {
      setSaved({
        ALMOCO: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null },
        JANTA: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null },
      });
      return;
    }

    const [l, j] = await Promise.all([
      fetchSavedForShift(worksiteId, restaurantId, mealDate, "ALMOCO"),
      fetchSavedForShift(worksiteId, restaurantId, mealDate, "JANTA"),
    ]);
    setSaved({ ALMOCO: l, JANTA: j });
  }

  async function refreshLotSummaries() {
    if (!worksiteId) {
      setLotSummaries([]);
      return;
    }

    const { data: orders, error: orderErr } = await supabase
      .from("meal_orders")
      .select("id,shift,restaurant_id,confirmed_at,status")
      .eq("worksite_id", worksiteId)
      .eq("meal_date", mealDate)
      .order("shift", { ascending: true });

    if (orderErr) throw orderErr;
    const orderRows = (orders || []) as any[];
    if (orderRows.length === 0) {
      setLotSummaries([]);
      return;
    }

    const orderIds = orderRows.map((o) => String(o.id));
    const restaurantIds = Array.from(new Set(orderRows.map((o) => String(o.restaurant_id)).filter(Boolean)));

    const [{ data: lines, error: lineErr }, { data: rs, error: rsErr }] = await Promise.all([
      supabase.from("meal_order_lines").select("meal_order_id").in("meal_order_id", orderIds).eq("included", true),
      supabase.from("meal_restaurants").select("id,name,city").in("id", restaurantIds),
    ]);

    if (lineErr) throw lineErr;
    if (rsErr) throw rsErr;

    const countMap = new Map<string, number>();
    (lines || []).forEach((r: any) => {
      const id = String(r.meal_order_id);
      countMap.set(id, (countMap.get(id) || 0) + 1);
    });

    const restMap = new Map<string, string>();
    (rs || []).forEach((r: any) => {
      restMap.set(String(r.id), `${r.name}${r.city ? ` - ${r.city}` : ""}`);
    });

    const list: LotSummary[] = orderRows.map((o) => ({
      orderId: String(o.id),
      shift: o.shift as Shift,
      restaurantId: String(o.restaurant_id),
      restaurantName: restMap.get(String(o.restaurant_id)) || String(o.restaurant_id),
      qty: countMap.get(String(o.id)) || 0,
      confirmedAt: o.confirmed_at ? String(o.confirmed_at) : null,
      status: o.status ? String(o.status) : null,
    }));

    list.sort((a, b) => a.shift.localeCompare(b.shift) || a.restaurantName.localeCompare(b.restaurantName, "pt-BR"));
    setLotSummaries(list);
  }

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const [wRows] = await Promise.all([loadWorksites(), loadRestaurants()]);
      const storedRaw = localStorage.getItem(LS_KEY);

      let nextWorksiteId = wRows[0]?.id || "";
      let nextRequesterId = "";

      if (storedRaw) {
        try {
          const stored = JSON.parse(storedRaw) as { worksiteId?: string; requesterId?: string };
          if (stored?.worksiteId && wRows.some((w) => w.id === stored.worksiteId)) {
            nextWorksiteId = stored.worksiteId;
          }
          nextRequesterId = stored?.requesterId || "";
        } catch {
          localStorage.removeItem(LS_KEY);
        }
      }

      setWorksiteId(nextWorksiteId);
      const reqRows = await loadRequestersForWorksite(nextWorksiteId);

      if (nextRequesterId && reqRows.some((r) => r.id === nextRequesterId)) {
        setRequesterId(nextRequesterId);
        setAccessReady(true);
      } else {
        setRequesterId(reqRows[0]?.id || "");
        setAccessReady(false);
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
      setBootLoaded(true);
    }
  }

  useEffect(() => {
    bootstrap();
  }, []);

  useEffect(() => {
    if (!bootLoaded) return;
    (async () => {
      try {
        await loadRequestersForWorksite(worksiteId);
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar solicitantes.");
      }
    })();
  }, [bootLoaded, worksiteId]);

  useEffect(() => {
    (async () => {
      if (!accessReady || !worksiteId || !restaurantId) return;
      setLoading(true);
      setError(null);
      setOkMsg(null);
      try {
        await Promise.all([loadEmployeesAndFavorites(worksiteId), loadRestaurantContract(restaurantId, mealDate)]);
        setSelectedLunch(new Set());
        setSelectedDinner(new Set());
        setVisitorsLunch([]);
        setVisitorsDinner([]);
        await Promise.all([refreshSaved(), refreshLotSummaries()]);
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar dados.");
      } finally {
        setLoading(false);
      }
    })();
  }, [accessReady, worksiteId, restaurantId, mealDate]);

  function enterApp() {
    setError(null);
    if (!worksiteId) {
      setError("Selecione a obra.");
      return;
    }
    if (!requesterId) {
      setError("Selecione quem está fazendo o pedido.");
      return;
    }
    saveAccess(worksiteId, requesterId);
    setAccessReady(true);
  }

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
    if (!worksiteId || !restaurantId) {
      setError("Selecione obra e restaurante.");
      return;
    }
    const y = addDaysISO(mealDate, -1);
    try {
      if (target === "ALMOCO") {
        const snap = await fetchSavedForShift(worksiteId, restaurantId, y, "ALMOCO");
        setSelectedLunch(new Set(snap.employeeIds || []));
        setVisitorsLunch(snap.visitors || []);
        setOkMsg(`Copiado de ontem (${formatBRFromISO(y)}) para ALMOÇO.`);
        return;
      }
      if (target === "JANTA") {
        const snap = await fetchSavedForShift(worksiteId, restaurantId, y, "JANTA");
        setSelectedDinner(new Set(snap.employeeIds || []));
        setVisitorsDinner(snap.visitors || []);
        setOkMsg(`Copiado de ontem (${formatBRFromISO(y)}) para JANTA.`);
        return;
      }
      const [l, j] = await Promise.all([
        fetchSavedForShift(worksiteId, restaurantId, y, "ALMOCO"),
        fetchSavedForShift(worksiteId, restaurantId, y, "JANTA"),
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

  function addVisitor(targetShift: Shift) {
    setVisitorModal({ open: true, targetShift, name: "", error: null });
  }

  function handleVisitorConfirm() {
    const name = visitorModal.name.trim();
    if (!name) {
      setVisitorModal((p) => ({ ...p, error: "Informe o nome." }));
      return;
    }
    if (visitorModal.targetShift === "ALMOCO") {
      setVisitorsLunch((p) => uniq([...p, name]));
    } else {
      setVisitorsDinner((p) => uniq([...p, name]));
    }
    setVisitorModal({ open: false, targetShift: "ALMOCO", name: "", error: null });
  }

  async function saveShift(shift: Shift, forceReopen = false) {
    setError(null);
    setOkMsg(null);
    if (!worksiteId) return setError("Selecione a obra."), undefined;
    if (!restaurantId) return setError("Selecione o restaurante do lote."), undefined;
    if (!requesterId) return setError("Selecione quem está fazendo o pedido."), undefined;

    const selectedIds = shift === "ALMOCO" ? Array.from(selectedLunch) : Array.from(selectedDinner);
    const visitors = shift === "ALMOCO" ? visitorsLunch : visitorsDinner;
    const total = selectedIds.length + visitors.length;
    if (total <= 0) return setError("Nenhuma refeição marcada para salvar."), undefined;

    setSaving((p) => ({ ...p, [shift]: true }));
    try {
      const cutoffTime = shift === "ALMOCO" ? restaurantContract?.cutoff_lunch ?? null : restaurantContract?.cutoff_dinner ?? null;
      const cutoffAtISO = buildCutoffAtISO(mealDate, cutoffTime);
      const allowAfter = Boolean(restaurantContract?.allow_after_cutoff);
      const now = new Date();

      if (cutoffAtISO && !allowAfter) {
        const cutoffAt = new Date(cutoffAtISO);
        if (mealDate === isoTodayLocal() && now.getTime() > cutoffAt.getTime()) {
          throw new Error(`Fora do horário limite (${shift === "ALMOCO" ? limits.lunch : limits.dinner}).`);
        }
      }

      const { data: existing, error: e1 } = await supabase
        .from("meal_orders")
        .select("id,confirmed_at")
        .eq("worksite_id", worksiteId)
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate)
        .eq("shift", shift)
        .limit(1)
        .maybeSingle();
      if (e1) throw e1;

      let orderId = (existing as any)?.id ? String((existing as any).id) : null;
      if (orderId && (existing as any)?.confirmed_at && !forceReopen) {
        setPendingReopenShift(shift);
        setSaving((p) => ({ ...p, [shift]: false }));
        return;
      }

      if (!orderId) {
        const ins = await supabase
          .from("meal_orders")
          .insert({
            worksite_id: worksiteId,
            restaurant_id: restaurantId,
            meal_date: mealDate,
            shift,
            status: "DRAFT",
            cutoff_at: cutoffAtISO,
            order_date: mealDate,
          })
          .select("id")
          .single();
        if (ins.error) throw ins.error;
        orderId = String((ins.data as any)?.id);
      } else {
        const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
        if (del.error) throw del.error;
        const baseUpdate: any = { cutoff_at: cutoffAtISO, submitted_at: null, confirmed_at: null, closed_at: null };
        const up1 = await supabase.from("meal_orders").update({ ...baseUpdate, status: "DRAFT" as any }).eq("id", orderId);
        if (up1.error) {
          const msg = String(up1.error.message || "");
          if (msg.includes("invalid input value for enum") || msg.includes("meal_order_status")) {
            const up2 = await supabase.from("meal_orders").update(baseUpdate).eq("id", orderId);
            if (up2.error) throw up2.error;
          } else {
            throw up1.error;
          }
        }
      }

      const rows: any[] = [];
      for (const eid of selectedIds) rows.push({ meal_order_id: orderId, employee_id: eid, included: true });
      for (const v of visitors) rows.push({ meal_order_id: orderId, visitor_name: v, included: true });
      const insLines = await supabase.from("meal_order_lines").insert(rows);
      if (insLines.error) throw insLines.error;

      await Promise.all([refreshSaved(), refreshLotSummaries()]);
      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} salvo para este restaurante (${total}).`);
    } catch (e: any) {
      const msg = String(e?.message || "Erro ao salvar.");
      if (msg.toLowerCase().includes("já possui refeição lançada neste dia/turno")) {
        setError("Um ou mais funcionários já estão lançados em outro restaurante neste mesmo dia/turno.");
      } else {
        setError(msg || "Erro ao salvar.");
      }
    } finally {
      setSaving((p) => ({ ...p, [shift]: false }));
    }
  }

  async function handleConfirmReopen() {
    const shift = pendingReopenShift;
    if (!shift) return;
    setPendingReopenShift(null);
    await saveShift(shift, true);
  }

  async function cancelShift(shift: Shift) {
    setError(null);
    setOkMsg(null);
    if (!worksiteId || !restaurantId) {
      setError("Selecione obra e restaurante.");
      return;
    }
    setCanceling((p) => ({ ...p, [shift]: true }));
    try {
      let orderId = saved[shift]?.orderId || null;
      if (!orderId) {
        const snap = await fetchSavedForShift(worksiteId, restaurantId, mealDate, shift);
        orderId = snap.orderId;
      }
      if (!orderId) {
        setOkMsg("Nada salvo para cancelar.");
        return;
      }

      const { data: orderCheck, error: checkErr } = await supabase.from("meal_orders").select("confirmed_at").eq("id", orderId).single();
      if (checkErr) throw checkErr;
      if ((orderCheck as any)?.confirmed_at) {
        setError(`Este pedido já foi confirmado pelo restaurante às ${new Date((orderCheck as any).confirmed_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Entre em contato com o restaurante para cancelar.`);
        return;
      }
      setPendingCancelShift(shift);
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setCanceling((p) => ({ ...p, [shift]: false }));
    }
  }

  async function handleConfirmCancel() {
    const shift = pendingCancelShift;
    if (!shift || !worksiteId || !restaurantId) return;

    setPendingCancelShift(null);
    setError(null);
    setOkMsg(null);
    setCanceling((p) => ({ ...p, [shift]: true }));

    try {
      let orderId = saved[shift]?.orderId || null;
      if (!orderId) {
        const snap = await fetchSavedForShift(worksiteId, restaurantId, mealDate, shift);
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

      await Promise.all([refreshSaved(), refreshLotSummaries()]);
      clearSelection(shift);
      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado para este restaurante.`);
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setCanceling((p) => ({ ...p, [shift]: false }));
    }
  }

  async function copyResumo() {
    const ws = worksites.find((w) => w.id === worksiteId);
    const rs = restaurants.find((r) => r.id === restaurantId);
    const wsName = ws ? `${ws.name}${ws.city ? " - " + ws.city : ""}` : "-";
    const rsName = rs ? `${rs.name}${rs.city ? " - " + rs.city : ""}` : "-";
    const requesterName = currentRequester?.name || "-";
    const lunchNames = employees.filter((e) => selectedLunch.has(e.id)).map((e) => e.full_name);
    const dinnerNames = employees.filter((e) => selectedDinner.has(e.id)).map((e) => e.full_name);

    const msg =
      `📍 Obra: ${wsName}
` +
      `🙋 Solicitado por: ${requesterName}
` +
      `🍽️ Restaurante: ${rsName}
` +
      `📅 Data: ${formatBRFromISO(mealDate)}

` +
      `🍽️ Almoço (${totals.lunch}):
` +
      `${[...lunchNames, ...visitorsLunch].map((x) => `- ${x}`).join("\n") || "-"}

` +
      `🌙 Janta (${totals.dinner}):
` +
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
    if (!restaurantId) return true;
    if (mode === "ALMOCO") return totals.lunch <= 0 || saving.ALMOCO;
    if (mode === "JANTA") return totals.dinner <= 0 || saving.JANTA;
    return (totals.lunch <= 0 && totals.dinner <= 0) || saving.ALMOCO || saving.JANTA;
  }, [mode, totals, saving, restaurantId]);

  async function handleBottomSave() {
    if (mode === "ALMOCO") return saveShift("ALMOCO");
    if (mode === "JANTA") return saveShift("JANTA");
    await saveShift("ALMOCO");
    await saveShift("JANTA");
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
    if (!restaurantId) return true;
    if (mode === "ALMOCO") return canceling.ALMOCO || savedCounts.lunch <= 0;
    if (mode === "JANTA") return canceling.JANTA || savedCounts.dinner <= 0;
    return (savedCounts.lunch <= 0 && savedCounts.dinner <= 0) || canceling.ALMOCO || canceling.JANTA;
  }, [mode, canceling, savedCounts, restaurantId]);

  if (!accessReady) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48 }}>
          <header className="page-header" style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
              <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>Refeições</div>
              <div className="brand-text-sub">Acesso interno do solicitante</div>
            </div>
          </header>

          <div className="section-card" style={{ maxWidth: 460, margin: "0 auto" }}>
            <div className="section-header">
              <div>
                <div className="section-title">Entrar</div>
                <div className="section-subtitle">Selecione a obra e quem está fazendo o pedido. O acesso fica salvo no navegador.</div>
              </div>
            </div>

            {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}

            <label style={styles.label}>Obra</label>
            <select style={styles.select} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)} disabled={loading || worksites.length === 0}>
              <option value="">{worksites.length === 0 ? "Nenhuma obra disponível" : "Selecione a obra"}</option>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.city ? ` - ${w.city}` : ""}</option>
              ))}
            </select>

            <div style={{ height: 10 }} />

            <label style={styles.label}>Solicitado por</label>
            <select style={styles.select} value={requesterId} onChange={(e) => setRequesterId(e.target.value)} disabled={loading || requesters.length === 0}>
              <option value="">{requesters.length === 0 ? "Nenhum solicitante disponível para esta obra" : "Selecione quem está pedindo"}</option>
              {requesters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>

            <div style={{ height: 10 }} />

            <button type="button" onClick={enterApp} style={{ width: "100%", borderRadius: 14, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff", padding: "12px 12px", fontSize: 15, fontWeight: 950, cursor: "pointer" }}>
              Entrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

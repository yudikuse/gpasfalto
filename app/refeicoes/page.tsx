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
  const router = useRouter();

  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [worksiteId, setWorksiteId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [mealDate, setMealDate] = useState(isoTodayLocal());
  const [restaurantContract, setRestaurantContract] = useState<RestaurantContract | null>(null);
  const [canOverrideCutoff, setCanOverrideCutoff] = useState(false);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUserId(null);
    setUserEmail("");
    router.replace("/refeicoes");
  }

  async function doLoginWithEmailPin() {
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
      setOkMsg("Login OK.");
    } catch (e: any) {
      setError(e?.message || "Falha no login.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function loadUser() {
    await supabase.auth.getSession();
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    setUserEmail(u?.email || "");
    const uid = u?.id || null;
    setUserId(uid);
    if (!uid) return null;
    const { data: ru, error: ruErr } = await supabase.from("meal_restaurant_users").select("restaurant_id").eq("user_id", uid).limit(1).maybeSingle();
    if (!ruErr && ru?.restaurant_id) {
      setUserId(null);
      router.replace("/refeicoes/restaurante");
      return null;
    }
    return uid;
  }

  async function loadWorksites() {
    const { data, error } = await supabase.from("meal_worksites").select("id,name,city,active").eq("active", true).order("name", { ascending: true });
    if (error) throw error;
    const rows = (data || []) as Worksite[];
    setWorksites(rows);
    setWorksiteId((prev) => prev || rows[0]?.id || "");
  }

  async function loadRestaurants() {
    const { data, error } = await supabase.from("meal_restaurants").select("id,name,city,active").eq("active", true).order("name", { ascending: true });
    if (error) throw error;
    const rows = (data || []) as Restaurant[];
    setRestaurants(rows);
    setRestaurantId((prev) => prev || rows[0]?.id || "");
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

  async function loadOverride(wid: string, uid: string | null) {
    if (!uid || !wid) {
      setCanOverrideCutoff(false);
      return;
    }
    const { data, error } = await supabase.from("meal_worksite_members").select("can_override_cutoff").eq("worksite_id", wid).eq("user_id", uid).maybeSingle();
    if (error) {
      setCanOverrideCutoff(false);
      return;
    }
    setCanOverrideCutoff(Boolean((data as any)?.can_override_cutoff));
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
    const { data: lines, error: e2 } = await supabase.from("meal_order_lines").select("id,employee_id,visitor_name,included").eq("meal_order_id", orderId).eq("included", true);
    if (e2) throw e2;
    const employeeIds = uniq((lines || []).map((r: any) => (r.employee_id ? String(r.employee_id) : "")).filter(Boolean));
    const visitors = uniq((lines || []).map((r: any) => (r.visitor_name ? String(r.visitor_name) : "")).filter(Boolean));
    return { orderId, employeeIds, visitors, confirmedAt };
  }

  async function refreshSaved() {
    if (!worksiteId || !restaurantId) {
      setSaved({ ALMOCO: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null }, JANTA: { orderId: null, employeeIds: [], visitors: [], confirmedAt: null } });
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
      const uid = await loadUser();
      if (!uid) return;
      await Promise.all([loadWorksites(), loadRestaurants()]);
      if (worksiteId) await loadOverride(worksiteId, uid);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    bootstrap();
    const { data } = supabase.auth.onAuthStateChange(() => {
      bootstrap();
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    (async () => {
      if (!worksiteId || !restaurantId) return;
      setLoading(true);
      setError(null);
      setOkMsg(null);
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id ?? null;
        await Promise.all([
          loadEmployeesAndFavorites(worksiteId),
          loadRestaurantContract(restaurantId, mealDate),
          loadOverride(worksiteId, uid),
        ]);
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
  }, [worksiteId, restaurantId, mealDate]);

  function toggleEmployee(shift: Shift, employeeId: string) {
    if (shift === "ALMOCO") {
      setSelectedLunch((prev) => {
        const n = new Set(prev);
        if (n.has(employeeId)) n.delete(employeeId);
        else n.add(employeeId);
        return n;
      });
      return;
    }
    setSelectedDinner((prev) => {
      const n = new Set(prev);
      if (n.has(employeeId)) n.delete(employeeId);
      else n.add(employeeId);
      return n;
    });
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

    const selectedIds = shift === "ALMOCO" ? Array.from(selectedLunch) : Array.from(selectedDinner);
    const visitors = shift === "ALMOCO" ? visitorsLunch : visitorsDinner;
    const total = selectedIds.length + visitors.length;
    if (total <= 0) return setError("Nenhuma refeição marcada para salvar."), undefined;

    setSaving((p) => ({ ...p, [shift]: true }));
    try {
      const { data: ud } = await supabase.auth.getUser();
      const uid = ud?.user?.id ?? null;

      const cutoffTime = shift === "ALMOCO" ? restaurantContract?.cutoff_lunch ?? null : restaurantContract?.cutoff_dinner ?? null;
      const cutoffAtISO = buildCutoffAtISO(mealDate, cutoffTime);
      const allowAfter = Boolean(restaurantContract?.allow_after_cutoff);
      const now = new Date();
      if (cutoffAtISO && !allowAfter && !canOverrideCutoff) {
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
            created_by: uid,
            updated_by: uid,
            order_date: mealDate,
          })
          .select("id")
          .single();
        if (ins.error) throw ins.error;
        orderId = String((ins.data as any)?.id);
      } else {
        const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
        if (del.error) throw del.error;
        const baseUpdate: any = {
          cutoff_at: cutoffAtISO,
          updated_by: uid,
          submitted_at: null,
          confirmed_at: null,
          closed_at: null,
        };
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
      for (const eid of selectedIds) rows.push({ meal_order_id: orderId, employee_id: eid, included: true, created_by: uid, updated_by: uid });
      for (const v of visitors) rows.push({ meal_order_id: orderId, visitor_name: v, included: true, created_by: uid, updated_by: uid });
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
    const lunchNames = employees.filter((e) => selectedLunch.has(e.id)).map((e) => e.full_name);
    const dinnerNames = employees.filter((e) => selectedDinner.has(e.id)).map((e) => e.full_name);
    const msg =
      `📍 Obra: ${wsName}\n` +
      `🍽️ Restaurante: ${rsName}\n` +
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

  if (!userId) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48 }}>
          <header className="page-header" style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
              <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>Refeições</div>
              <div className="brand-text-sub">Acesso do encarregado</div>
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
            {okMsg ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>{okMsg}</div> : null}
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
            <button type="button" onClick={doLoginWithEmailPin} disabled={loggingIn} style={{ width: "100%", borderRadius: 14, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff", padding: "12px 12px", fontSize: 15, fontWeight: 950, cursor: loggingIn ? "not-allowed" : "pointer", opacity: loggingIn ? 0.7 : 1 }}>
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 240 }}>
        <header className="page-header" style={{ alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 28, height: 28, objectFit: "contain", border: "none", background: "transparent" }} />
            <div>
              <div className="brand-text-main" style={{ lineHeight: 1.1 }}>Refeições</div>
              <div className="brand-text-sub">Lotes por restaurante</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 800 }}>{headerDatePill}</div>
            <button type="button" onClick={handleSignOut} style={{ borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 900, cursor: "pointer" }}>Sair</button>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle" style={{ marginTop: 2 }}>Agora cada pedido é um lote por restaurante. A mesma obra pode ter mais de um restaurante no mesmo turno.</div>
            </div>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>
          </div>

          {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
          {okMsg ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>{okMsg}</div> : null}

          {pendingCancelShift ? (
            <div style={{ borderRadius: 14, padding: "14px 14px", border: "1px solid #fecaca", background: "#fef2f2", marginBottom: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#991b1b", marginBottom: 6 }}>🗑️ Cancelar {pendingCancelShift === "ALMOCO" ? "Almoço" : "Janta"}?</div>
              <div style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 12 }}>O lote deste restaurante será apagado do banco. Tem certeza?</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setPendingCancelShift(null)} style={{ flex: 1, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Não, voltar</button>
                <button type="button" onClick={handleConfirmCancel} style={{ flex: 1, borderRadius: 12, border: "1px solid #fecaca", background: "#dc2626", color: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Sim, cancelar lote</button>
              </div>
            </div>
          ) : null}

          {pendingReopenShift ? (
            <div style={{ borderRadius: 14, padding: "14px 14px", border: "1px solid #fde68a", background: "#fffbeb", marginBottom: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#92400e", marginBottom: 6 }}>⚠️ Lote de {pendingReopenShift === "ALMOCO" ? "Almoço" : "Janta"} já confirmado</div>
              <div style={{ fontSize: 13, color: "#78350f", marginBottom: 12 }}>Se você editar agora, a confirmação deste restaurante será desfeita. Deseja continuar?</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button type="button" onClick={() => setPendingReopenShift(null)} style={{ flex: 1, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Cancelar</button>
                <button type="button" onClick={handleConfirmReopen} style={{ flex: 1, borderRadius: 12, border: "1px solid #fde68a", background: "#f59e0b", color: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Sim, editar mesmo assim</button>
              </div>
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Obra</label>
              <select style={styles.select} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)} disabled={loading || worksites.length === 0}>
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}{w.city ? ` - ${w.city}` : ""}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Restaurante do lote</label>
              <select style={styles.select} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} disabled={loading || restaurants.length === 0}>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.city ? ` - ${r.city}` : ""}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={mealDate} onChange={(e) => setMealDate(e.target.value)} disabled={loading} />
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Buscar</label>
              <input style={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome do funcionário..." />
            </div>
            <div style={{ gridColumn: "span 12", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(mode === "ALMOCO", "lunch")} onClick={() => setMode("ALMOCO")}>Almoço</button>
                <button type="button" style={segBtnStyle(mode === "JANTA", "dinner")} onClick={() => setMode("JANTA")}>Janta</button>
                <button type="button" style={segBtnStyle(mode === "AMBOS", "neutral")} onClick={() => setMode("AMBOS")}>Ambos</button>
                <div style={{ marginLeft: 8, fontSize: 12, color: "var(--gp-muted-soft)", alignSelf: "center" }}>
                  Limites do restaurante: Almoço <b>{limits.lunch}</b> • Janta <b>{limits.dinner}</b>
                  {canOverrideCutoff ? <span style={{ marginLeft: 8 }}>(override ativo)</span> : null}
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 800 }}>
                <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
                Mostrar só marcados
              </label>
            </div>
            <div style={{ gridColumn: "span 12", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => copyYesterday(mode)} disabled={loading}>Copiar ontem</button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => restoreSaved(mode)} disabled={loading}>Restaurar salvo</button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => clearSelection(mode)} disabled={loading}>Limpar</button>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={copyResumo} disabled={loading}>Copiar resumo</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ borderRadius: 999, border: "1px solid #86efac", background: "#ecfdf5", color: "#166534", padding: "6px 10px", fontSize: 12, fontWeight: 900 }}>Almoço: {totals.lunch} (salvo: {savedCounts.lunch})</div>
                <div style={{ borderRadius: 999, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8", padding: "6px 10px", fontSize: 12, fontWeight: 900 }}>Janta: {totals.dinner} (salvo: {savedCounts.dinner})</div>
              </div>
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Lotes do dia nesta obra</div>
              <div className="section-subtitle">Você pode ter mais de um restaurante no mesmo turno. O restaurante selecionado acima é o lote que será salvo/editado agora.</div>
            </div>
          </div>
          {lotSummaries.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Nenhum lote salvo para esta obra/data.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {lotSummaries.map((lot) => {
                const active = lot.restaurantId === restaurantId;
                return (
                  <button
                    key={lot.orderId}
                    type="button"
                    onClick={() => setRestaurantId(lot.restaurantId)}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 14px",
                      borderRadius: 14,
                      border: active ? "1px solid #93c5fd" : "1px solid #e5e7eb",
                      background: active ? "#eff6ff" : "#fff",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a" }}>{lot.shift === "ALMOCO" ? "Almoço" : "Janta"} • {lot.restaurantName}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {lot.confirmedAt ? `✅ Confirmado às ${new Date(lot.confirmedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "⏳ Aguardando confirmação"}
                      </div>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 950, color: "#0f172a" }}>{lot.qty}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Funcionários</div>
              <div className="section-subtitle">Favoritos da obra aparecem primeiro. Um funcionário não pode ser lançado duas vezes no mesmo turno, mesmo em restaurantes diferentes.</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {filteredEmployees.map((e) => {
              const lunchOn = selectedLunch.has(e.id);
              const dinnerOn = selectedDinner.has(e.id);
              return (
                <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: 8, alignItems: "center", borderRadius: 14, border: "1px solid #eef2f7", background: favoriteIds.has(e.id) ? "#fcfcfd" : "#fff", padding: "10px 12px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.full_name}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{favoriteIds.has(e.id) ? "★ Favorito desta obra" : e.is_third_party ? "Terceiro" : "Equipe"}</div>
                  </div>
                  <button type="button" onClick={() => toggleEmployee("ALMOCO", e.id)} style={segBtnStyle(lunchOn, "lunch")}>Almoço</button>
                  <button type="button" onClick={() => toggleEmployee("JANTA", e.id)} style={segBtnStyle(dinnerOn, "dinner")}>Janta</button>
                  <div style={{ fontSize: 11, fontWeight: 900, color: "#94a3b8", width: 28, textAlign: "center" }}>{lunchOn || dinnerOn ? "✓" : ""}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Visitantes</div>
              <div className="section-subtitle">Visitantes entram sem cadastro e contam normalmente no lote.</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#166534" }}>Almoço ({visitorsLunch.length})</div>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => addVisitor("ALMOCO")}>+ Visitante</button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {visitorsLunch.length === 0 ? <div style={styles.hint}>Nenhum visitante.</div> : visitorsLunch.map((v) => (
                  <div key={v} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 12, border: "1px solid #e5e7eb", padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{v}</div>
                    <button type="button" onClick={() => setVisitorsLunch((p) => p.filter((x) => x !== v))} style={{ border: "none", background: "transparent", color: "#dc2626", fontWeight: 900, cursor: "pointer" }}>Remover</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 900, color: "#1d4ed8" }}>Janta ({visitorsDinner.length})</div>
                <button type="button" style={segBtnStyle(false, "neutral")} onClick={() => addVisitor("JANTA")}>+ Visitante</button>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {visitorsDinner.length === 0 ? <div style={styles.hint}>Nenhum visitante.</div> : visitorsDinner.map((v) => (
                  <div key={v} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 12, border: "1px solid #e5e7eb", padding: "8px 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 800 }}>{v}</div>
                    <button type="button" onClick={() => setVisitorsDinner((p) => p.filter((x) => x !== v))} style={{ border: "none", background: "transparent", color: "#dc2626", fontWeight: 900, cursor: "pointer" }}>Remover</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 60, padding: 12, background: "linear-gradient(180deg, rgba(243,244,246,0) 0%, rgba(243,244,246,0.94) 24%, rgba(243,244,246,1) 100%)" }}>
        <div className="page-container" style={{ padding: 0 }}>
          <div style={{ borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: 12, boxShadow: "0 18px 38px rgba(15,23,42,0.08)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div style={{ borderRadius: 14, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.lunch}</div>
                {saved.ALMOCO.orderId ? (
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: saved.ALMOCO.confirmedAt ? "#166534" : "#92400e" }}>
                    {saved.ALMOCO.confirmedAt ? `✅ Confirmado às ${new Date(saved.ALMOCO.confirmedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "⏳ Aguardando confirmação"}
                  </div>
                ) : null}
              </div>
              <div style={{ borderRadius: 14, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.dinner}</div>
                {saved.JANTA.orderId ? (
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: saved.JANTA.confirmedAt ? "#1d4ed8" : "#92400e" }}>
                    {saved.JANTA.confirmedAt ? `✅ Confirmado às ${new Date(saved.JANTA.confirmedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "⏳ Aguardando confirmação"}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <button type="button" onClick={handleBottomSave} style={bigBtnStyle(mode === "JANTA" ? "primaryDinner" : "primaryLunch", bottomSaveDisabled)} disabled={bottomSaveDisabled}>{bottomTitle}</button>
              <button type="button" onClick={handleBottomCancel} style={bigBtnStyle("danger", bottomCancelDisabled)} disabled={bottomCancelDisabled}>{bottomCancelLabel}</button>
            </div>
          </div>
        </div>
      </div>

      {visitorModal.open ? (
        <div
          onClick={() => setVisitorModal({ open: false, targetShift: "ALMOCO", name: "", error: null })}
          style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(15,23,42,0.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, borderRadius: 18, border: "1px solid #e5e7eb", background: "#fff", padding: 16, boxShadow: "0 24px 48px rgba(15,23,42,0.18)" }}>
            <div style={{ fontSize: 16, fontWeight: 950, color: "#0f172a" }}>Adicionar visitante</div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#64748b" }}>Turno: <b>{visitorModal.targetShift === "ALMOCO" ? "Almoço" : "Janta"}</b></div>
            <div style={{ height: 12 }} />
            <input
              autoFocus
              placeholder="Nome do visitante"
              style={{ width: "100%", borderRadius: 14, border: `1px solid ${visitorModal.error ? "#fca5a5" : "#e5e7eb"}`, padding: "12px 12px", fontSize: 16, outline: "none", background: "#fff", color: "#0f172a" }}
              value={visitorModal.name}
              onChange={(e) => setVisitorModal((p) => ({ ...p, name: e.target.value, error: null }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleVisitorConfirm();
                if (e.key === "Escape") setVisitorModal({ open: false, targetShift: "ALMOCO", name: "", error: null });
              }}
            />
            {visitorModal.error ? <div style={{ marginTop: 6, fontSize: 12, color: "#dc2626", fontWeight: 700 }}>{visitorModal.error}</div> : null}
            <div style={{ height: 12 }} />
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => setVisitorModal({ open: false, targetShift: "ALMOCO", name: "", error: null })} style={{ flex: 1, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Cancelar</button>
              <button type="button" onClick={handleVisitorConfirm} style={{ flex: 1, borderRadius: 12, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff", padding: "10px 12px", fontSize: 14, fontWeight: 900, cursor: "pointer" }}>Adicionar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

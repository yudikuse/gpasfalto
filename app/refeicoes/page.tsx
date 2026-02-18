// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type ViewMode = "ALMOCO" | "JANTA" | "AMBOS";

type Worksite = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type Employee = {
  id: string;
  full_name: string;
  active: boolean | null;
  is_third_party: boolean | null;
};

type Contract = {
  id: string;
  restaurant_id: string;
  cutoff_lunch: string | null;
  cutoff_dinner: string | null;
  allow_after_cutoff: boolean | null;
};

type Order = {
  id: string;
  restaurant_id: string;
  status: string | null;
  shift: Shift;
  created_at?: string | null;
  updated_at?: string | null;
};

type Pick = { ALMOCO: boolean; JANTA: boolean };

function isoLocalToday() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  const d2 = new Date(d.getTime() - off * 60 * 1000);
  return d2.toISOString().slice(0, 10);
}

function isoLocalAddDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const off = dt.getTimezoneOffset();
  const d2 = new Date(dt.getTime() - off * 60 * 1000);
  return d2.toISOString().slice(0, 10);
}

function parseHHMM(t: string | null) {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return { hh, mm };
}

function nowAfterCutoff(cutoff: string | null) {
  const c = parseHHMM(cutoff);
  if (!c) return false;
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  return hh > c.hh || (hh === c.hh && mm > c.mm);
}

function fmtHHMMFromISO(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function shiftLabel(shift: Shift) {
  return shift === "ALMOCO" ? "Almoço" : "Janta";
}

function shiftEmoji(shift: Shift) {
  return shift === "ALMOCO" ? "🍽️" : "🌙";
}

function shiftTone(shift: Shift) {
  // lunch: green-ish, dinner: blue-ish
  return shift === "ALMOCO"
    ? {
        bgOn: "rgba(16,185,129,0.12)",
        bdOn: "rgba(16,185,129,0.35)",
        txOn: "#065f46",
        btnOn: "rgba(16,185,129,0.18)",
        btnBd: "rgba(16,185,129,0.45)",
        btnTx: "#065f46",
      }
    : {
        bgOn: "rgba(59,130,246,0.10)",
        bdOn: "rgba(59,130,246,0.35)",
        txOn: "#1d4ed8",
        btnOn: "rgba(59,130,246,0.14)",
        btnBd: "rgba(59,130,246,0.45)",
        btnTx: "#1d4ed8",
      };
}

export default function RefeicoesPage() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginSent, setLoginSent] = useState<boolean>(false);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>("");

  const [dateISO, setDateISO] = useState<string>(isoLocalToday());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [favoritesIds, setFavoritesIds] = useState<Set<string>>(new Set());

  const [contract, setContract] = useState<Contract | null>(null);

  const [orderLunch, setOrderLunch] = useState<Order | null>(null);
  const [orderDinner, setOrderDinner] = useState<Order | null>(null);

  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [savedSets, setSavedSets] = useState<{ ALMOCO: Set<string>; JANTA: Set<string> }>({
    ALMOCO: new Set(),
    JANTA: new Set(),
  });
  const [savedAt, setSavedAt] = useState<{ ALMOCO: string | null; JANTA: string | null }>({
    ALMOCO: null,
    JANTA: null,
  });

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");

  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newIsThird, setNewIsThird] = useState<boolean>(false);

  // new UI states
  const [viewMode, setViewMode] = useState<ViewMode>("ALMOCO");
  const [showOnlyMarked, setShowOnlyMarked] = useState<boolean>(false);
  const [showTools, setShowTools] = useState<boolean>(false);

  const activeShift: Shift = viewMode === "JANTA" ? "JANTA" : "ALMOCO";

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      const uid = data.session?.user?.id ?? null;
      const em = data.session?.user?.email ?? "";
      setSessionUserId(uid);
      setUserEmail(em);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      const uid = s?.user?.id ?? null;
      const em = s?.user?.email ?? "";
      setSessionUserId(uid);
      setUserEmail(em);
      setLoginSent(false);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;

    (async () => {
      setBusy("Carregando obras e equipe...");
      setToast(null);

      const [wsRes, empRes] = await Promise.all([
        supabase.from("meal_worksites").select("id,name,city,active").eq("active", true).order("name", { ascending: true }),
        supabase
          .from("meal_employees")
          .select("id,full_name,active,is_third_party")
          .eq("active", true)
          .order("full_name", { ascending: true }),
      ]);

      if (wsRes.error) {
        setBusy(null);
        setToast(`Erro obras: ${wsRes.error.message}`);
        return;
      }
      if (empRes.error) {
        setBusy(null);
        setToast(`Erro funcionários: ${empRes.error.message}`);
        return;
      }

      const ws = (wsRes.data ?? []) as Worksite[];
      const emps = (empRes.data ?? []) as Employee[];

      setWorksites(ws);
      setEmployees(emps);

      if (!selectedWorksiteId && ws.length > 0) setSelectedWorksiteId(ws[0].id);

      const map: Record<string, Pick> = {};
      for (const e of emps) map[e.id] = { ALMOCO: false, JANTA: false };
      setPicks(map);

      setSavedSets({ ALMOCO: new Set(), JANTA: new Set() });
      setSavedAt({ ALMOCO: null, JANTA: null });

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  useEffect(() => {
    if (!sessionUserId) return;
    if (!selectedWorksiteId) return;
    if (employees.length === 0) return;

    (async () => {
      setBusy("Carregando pedido...");
      setToast(null);

      const favRes = await supabase
        .from("meal_worksite_favorites")
        .select("employee_id")
        .eq("worksite_id", selectedWorksiteId);

      if (favRes.error) {
        setBusy(null);
        setToast(`Erro favoritos: ${favRes.error.message}`);
        return;
      }
      setFavoritesIds(new Set((favRes.data ?? []).map((r: any) => r.employee_id)));

      const ctRes = await supabase
        .from("meal_contracts")
        .select("id,restaurant_id,cutoff_lunch,cutoff_dinner,allow_after_cutoff,start_date")
        .eq("worksite_id", selectedWorksiteId)
        .lte("start_date", dateISO)
        .order("start_date", { ascending: false })
        .limit(1);

      if (ctRes.error) {
        setBusy(null);
        setToast(`Erro contrato: ${ctRes.error.message}`);
        return;
      }

      const ct = (ctRes.data?.[0] ?? null) as any;
      if (!ct) {
        setContract(null);
        setOrderLunch(null);
        setOrderDinner(null);

        const empty: Record<string, Pick> = {};
        for (const e of employees) empty[e.id] = { ALMOCO: false, JANTA: false };
        setPicks(empty);

        setSavedSets({ ALMOCO: new Set(), JANTA: new Set() });
        setSavedAt({ ALMOCO: null, JANTA: null });

        setBusy(null);
        setToast("Sem contrato para essa obra/data.");
        return;
      }

      const nextContract: Contract = {
        id: ct.id,
        restaurant_id: ct.restaurant_id,
        cutoff_lunch: ct.cutoff_lunch,
        cutoff_dinner: ct.cutoff_dinner,
        allow_after_cutoff: ct.allow_after_cutoff,
      };
      setContract(nextContract);

      async function fetchOrder(shift: Shift) {
        const oRes = await supabase
          .from("meal_orders")
          .select("id,restaurant_id,status,shift,created_at,updated_at")
          .eq("worksite_id", selectedWorksiteId)
          .eq("meal_date", dateISO)
          .eq("shift", shift)
          .order("created_at", { ascending: false })
          .limit(1);

        if (oRes.error) return { error: oRes.error, order: null as Order | null };
        const o = (oRes.data?.[0] ?? null) as Order | null;

        // Se algum status de cancelamento existir e tiver sido usado no seu banco:
        if (o?.status && String(o.status).toUpperCase() === "CANCELLED") {
          return { error: null, order: null as Order | null };
        }

        return { error: null, order: o };
      }

      const [lunch, dinner] = await Promise.all([fetchOrder("ALMOCO"), fetchOrder("JANTA")]);

      if (lunch.error) {
        setBusy(null);
        setToast(`Erro pedido almoço: ${lunch.error.message}`);
        return;
      }
      if (dinner.error) {
        setBusy(null);
        setToast(`Erro pedido janta: ${dinner.error.message}`);
        return;
      }

      setOrderLunch(lunch.order);
      setOrderDinner(dinner.order);

      const map: Record<string, Pick> = {};
      for (const e of employees) map[e.id] = { ALMOCO: false, JANTA: false };

      const savedLunch = new Set<string>();
      const savedDinner = new Set<string>();

      async function applyLines(order: Order | null, shift: Shift) {
        if (!order?.id) return;
        const lRes = await supabase.from("meal_order_lines").select("employee_id").eq("meal_order_id", order.id);

        if (lRes.error) throw new Error(lRes.error.message);
        const rows = (lRes.data ?? []) as any[];
        for (const r of rows) {
          const empId = r.employee_id as string;
          if (!map[empId]) map[empId] = { ALMOCO: false, JANTA: false };
          map[empId][shift] = true;
          if (shift === "ALMOCO") savedLunch.add(empId);
          else savedDinner.add(empId);
        }
      }

      try {
        await Promise.all([applyLines(lunch.order, "ALMOCO"), applyLines(dinner.order, "JANTA")]);
      } catch (e: any) {
        setBusy(null);
        setToast(`Erro itens: ${e?.message ?? "falha ao carregar itens"}`);
        return;
      }

      setPicks(map);
      setSavedSets({ ALMOCO: savedLunch, JANTA: savedDinner });

      setSavedAt({
        ALMOCO: lunch.order?.updated_at ?? lunch.order?.created_at ?? null,
        JANTA: dinner.order?.updated_at ?? dinner.order?.created_at ?? null,
      });

      setBusy(null);
    })();
  }, [sessionUserId, selectedWorksiteId, dateISO, employees]);

  const employeesOrdered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = employees.filter((e) => (q ? e.full_name.toLowerCase().includes(q) : true));

    const fav: Employee[] = [];
    const normal: Employee[] = [];
    const third: Employee[] = [];

    for (const e of filtered) {
      if (favoritesIds.has(e.id)) fav.push(e);
      else if (e.is_third_party) third.push(e);
      else normal.push(e);
    }

    return [...fav, ...normal, ...third];
  }, [employees, favoritesIds, search]);

  const totalsNow = useMemo(() => {
    let almoco = 0;
    let janta = 0;
    for (const empId of Object.keys(picks)) {
      if (picks[empId]?.ALMOCO) almoco++;
      if (picks[empId]?.JANTA) janta++;
    }
    return { almoco, janta };
  }, [picks]);

  const totalsSaved = useMemo(() => {
    return {
      almoco: savedSets.ALMOCO.size,
      janta: savedSets.JANTA.size,
      lunchSaved: !!orderLunch?.id,
      dinnerSaved: !!orderDinner?.id,
    };
  }, [savedSets, orderLunch, orderDinner]);

  const activeSelectedNames = useMemo(() => {
    const list = employeesOrdered
      .filter((e) => (viewMode === "AMBOS" ? (picks[e.id]?.ALMOCO || picks[e.id]?.JANTA) : picks[e.id]?.[activeShift]))
      .map((e) => e.full_name);
    return list;
  }, [employeesOrdered, picks, viewMode, activeShift]);

  const employeesVisible = useMemo(() => {
    let list = employeesOrdered;

    if (showOnlyMarked) {
      if (viewMode === "AMBOS") {
        list = list.filter((e) => picks[e.id]?.ALMOCO || picks[e.id]?.JANTA);
      } else {
        list = list.filter((e) => picks[e.id]?.[activeShift]);
      }
    }

    return list;
  }, [employeesOrdered, showOnlyMarked, viewMode, picks, activeShift]);

  function isShiftLocked(shift: Shift) {
    if (!contract) return true;
    const cutoff = shift === "ALMOCO" ? contract.cutoff_lunch : contract.cutoff_dinner;
    const late = nowAfterCutoff(cutoff);
    return late && contract.allow_after_cutoff === false;
  }

  async function sendMagicLink() {
    const email = loginEmail.trim().toLowerCase();
    if (!email) return;

    setBusy("Enviando link...");
    setToast(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/refeicoes`,
      },
    });

    setBusy(null);
    if (error) setToast(`Erro login: ${error.message}`);
    else setLoginSent(true);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  function togglePick(empId: string, shift: Shift) {
    setPicks((prev) => {
      const cur = prev[empId] ?? { ALMOCO: false, JANTA: false };
      return {
        ...prev,
        [empId]: { ...cur, [shift]: !cur[shift] },
      };
    });
  }

  function setAllShift(shift: Shift, value: boolean) {
    setPicks((prev) => {
      const next = { ...prev };
      for (const e of employees) {
        const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
        next[e.id] = { ...cur, [shift]: value };
      }
      return next;
    });
  }

  function clearShift(shift: Shift) {
    setPicks((prev) => {
      const next: Record<string, Pick> = { ...prev };
      for (const e of employees) {
        const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
        next[e.id] = { ...cur, [shift]: false };
      }
      return next;
    });
  }

  function clearAll() {
    setPicks((prev) => {
      const next: Record<string, Pick> = { ...prev };
      for (const key of Object.keys(next)) next[key] = { ALMOCO: false, JANTA: false };
      return next;
    });
  }

  function restoreSaved(shift: Shift) {
    const set = shift === "ALMOCO" ? savedSets.ALMOCO : savedSets.JANTA;
    setPicks((prev) => {
      const next: Record<string, Pick> = { ...prev };
      for (const e of employees) {
        const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
        next[e.id] = { ...cur, [shift]: set.has(e.id) };
      }
      return next;
    });
    setToast(`${shiftLabel(shift)} restaurado do salvo ✅`);
  }

  async function copyYesterday() {
    if (!selectedWorksiteId) return;
    const y = isoLocalAddDays(dateISO, -1);

    setBusy("Copiando ontem...");
    setToast(null);

    async function getOrderId(shift: Shift) {
      const oRes = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", selectedWorksiteId)
        .eq("meal_date", y)
        .eq("shift", shift)
        .order("created_at", { ascending: false })
        .limit(1);

      if (oRes.error) throw new Error(oRes.error.message);
      return (oRes.data?.[0]?.id as string | undefined) ?? null;
    }

    async function getLines(orderId: string | null) {
      if (!orderId) return new Set<string>();
      const lRes = await supabase.from("meal_order_lines").select("employee_id").eq("meal_order_id", orderId);
      if (lRes.error) throw new Error(lRes.error.message);
      return new Set((lRes.data ?? []).map((r: any) => r.employee_id as string));
    }

    try {
      const [oidLunch, oidDinner] = await Promise.all([getOrderId("ALMOCO"), getOrderId("JANTA")]);

      if (!oidLunch && !oidDinner) {
        setBusy(null);
        setToast("Ontem não tem pedido nessa obra.");
        return;
      }

      const [setLunch, setDinner] = await Promise.all([getLines(oidLunch), getLines(oidDinner)]);

      const map: Record<string, Pick> = {};
      for (const e of employees) {
        map[e.id] = { ALMOCO: setLunch.has(e.id), JANTA: setDinner.has(e.id) };
      }

      setPicks(map);
      setBusy(null);
      setToast("Copiado do dia anterior ✅");
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro copiar: ${e?.message ?? "falha"}`);
    }
  }

  async function ensureOrder(shift: Shift): Promise<Order | null> {
    if (!selectedWorksiteId || !contract) return null;

    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (existing?.id) {
      const upd = await supabase.from("meal_orders").update({ restaurant_id: contract.restaurant_id }).eq("id", existing.id);
      if (upd.error) throw new Error(upd.error.message);
      return existing;
    }

    const ins = await supabase
      .from("meal_orders")
      .insert({
        worksite_id: selectedWorksiteId,
        restaurant_id: contract.restaurant_id,
        meal_date: dateISO,
        shift,
        status: "DRAFT",
      })
      .select("id,restaurant_id,status,shift,created_at,updated_at")
      .single();

    if (ins.error) throw new Error(ins.error.message);

    const created = ins.data as Order;

    if (shift === "ALMOCO") setOrderLunch(created);
    else setOrderDinner(created);

    return created;
  }

  async function saveShift(shift: Shift) {
    if (!selectedWorksiteId) return;
    if (!contract) {
      setToast("Sem contrato para salvar.");
      return;
    }

    if (isShiftLocked(shift)) {
      setToast(`Passou do horário e este contrato não permite alterar ${shiftLabel(shift).toLowerCase()}.`);
      return;
    }

    setBusy(shift === "ALMOCO" ? "Salvando almoço..." : "Salvando janta...");
    setToast(null);

    try {
      const order = await ensureOrder(shift);
      if (!order?.id) {
        setBusy(null);
        setToast("Não foi possível criar/obter o pedido.");
        return;
      }

      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", order.id);
      if (del.error) throw new Error(del.error.message);

      const rows: any[] = [];
      for (const e of employees) {
        const p = picks[e.id];
        if (!p) continue;
        if (shift === "ALMOCO" && p.ALMOCO) rows.push({ meal_order_id: order.id, employee_id: e.id });
        if (shift === "JANTA" && p.JANTA) rows.push({ meal_order_id: order.id, employee_id: e.id });
      }

      if (rows.length > 0) {
        const insLines = await supabase.from("meal_order_lines").insert(rows);
        if (insLines.error) throw new Error(insLines.error.message);
      }

      // atualiza "salvo" localmente para bater o olho
      const nextSet = new Set<string>();
      for (const e of employees) {
        const p = picks[e.id];
        if (!p) continue;
        if (shift === "ALMOCO" && p.ALMOCO) nextSet.add(e.id);
        if (shift === "JANTA" && p.JANTA) nextSet.add(e.id);
      }

      setSavedSets((prev) => ({ ...prev, [shift]: nextSet }));
      setSavedAt((prev) => ({ ...prev, [shift]: new Date().toISOString() }));

      setBusy(null);
      setToast(`${shiftLabel(shift)} salvo ✅`);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro salvar: ${e?.message ?? "falha"}`);
    }
  }

  async function cancelShift(shift: Shift) {
    if (!selectedWorksiteId) return;
    if (!contract) {
      setToast("Sem contrato.");
      return;
    }

    if (isShiftLocked(shift)) {
      setToast(`Passou do horário e este contrato não permite cancelar ${shiftLabel(shift).toLowerCase()}.`);
      return;
    }

    const order = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (!order?.id) {
      setToast(`Não há ${shiftLabel(shift).toLowerCase()} salvo para cancelar.`);
      return;
    }

    const ok = window.confirm(`Cancelar ${shiftLabel(shift)} deste dia/obra?`);
    if (!ok) return;

    setBusy(shift === "ALMOCO" ? "Cancelando almoço..." : "Cancelando janta...");
    setToast(null);

    try {
      const delLines = await supabase.from("meal_order_lines").delete().eq("meal_order_id", order.id);
      if (delLines.error) throw new Error(delLines.error.message);

      // tenta marcar cancelado (se existir no enum), senão deleta o pedido
      const upd = await supabase.from("meal_orders").update({ status: "CANCELLED" }).eq("id", order.id);
      if (upd.error) {
        const delOrder = await supabase.from("meal_orders").delete().eq("id", order.id);
        if (delOrder.error) throw new Error(delOrder.error.message);
      }

      // limpa estado local
      clearShift(shift);
      setSavedSets((prev) => ({ ...prev, [shift]: new Set() }));
      setSavedAt((prev) => ({ ...prev, [shift]: null }));
      if (shift === "ALMOCO") setOrderLunch(null);
      else setOrderDinner(null);

      setBusy(null);
      setToast(`${shiftLabel(shift)} cancelado ✅`);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro cancelar: ${e?.message ?? "falha"}`);
    }
  }

  function buildSummary(shift: Shift) {
    const ws = worksites.find((w) => w.id === selectedWorksiteId);
    const wsName = ws ? `${ws.name}${ws.city ? ` - ${ws.city}` : ""}` : selectedWorksiteId;

    const selected = employeesOrdered
      .filter((e) => (shift === "ALMOCO" ? picks[e.id]?.ALMOCO : picks[e.id]?.JANTA))
      .map((e) => `- ${e.full_name}${e.is_third_party ? " (terceiro)" : ""}`);

    const qty = selected.length;
    const cutoff = contract
      ? `Horário limite: Almoço ${contract.cutoff_lunch ?? "--"} | Janta ${contract.cutoff_dinner ?? "--"}`
      : "";

    return (
      `Refeições • ${wsName} • ${dateISO}\n` +
      `Pedido: ${shift === "ALMOCO" ? "ALMOÇO" : "JANTA"}\n` +
      `Qtde: ${qty}\n` +
      (cutoff ? `${cutoff}\n\n` : "\n") +
      `${shift === "ALMOCO" ? "ALMOÇO" : "JANTA"}:\n` +
      (selected.length ? selected.join("\n") : "- (ninguém marcado)")
    );
  }

  async function copySummary(shift: Shift) {
    const text = buildSummary(shift);
    const ok = await copyToClipboard(text);
    setCopiedBanner(ok ? "Resumo copiado ✅ (cole no WhatsApp)" : "Falha ao copiar 😕");
    setTimeout(() => setCopiedBanner(null), 2500);
  }

  async function addEmployee() {
    const name = newName.trim();
    if (!name) {
      setToast("Informe o nome.");
      return;
    }

    setBusy("Adicionando pessoa...");
    setToast(null);

    const ins = await supabase
      .from("meal_employees")
      .insert({
        full_name: name,
        active: true,
        is_third_party: newIsThird,
      })
      .select("id,full_name,active,is_third_party")
      .single();

    setBusy(null);

    if (ins.error) {
      setToast(`Erro adicionar: ${ins.error.message}`);
      return;
    }

    const created = ins.data as Employee;

    setEmployees((prev) => {
      const next = [...prev, created];
      next.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return next;
    });

    setPicks((prev) => ({
      ...prev,
      [created.id]: { ALMOCO: false, JANTA: false },
    }));

    setNewName("");
    setNewIsThird(false);
    setShowAdd(false);
    setToast("Pessoa adicionada ✅");
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    padding: "10px 12px",
    background: "#fff",
    outline: "none",
  };

  const btnBase: CSSProperties = {
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    padding: "10px 12px",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
  };

  const btnGhost: CSSProperties = {
    ...btnBase,
    background: "rgba(255,255,255,0.7)",
  };

  const btnDanger: CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(239,68,68,0.35)",
    background: "rgba(239,68,68,0.10)",
    color: "#7f1d1d",
  };

  const btnPrimaryLunch: CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(16,185,129,0.45)",
    background: "rgba(16,185,129,0.85)",
    color: "#fff",
  };

  const btnPrimaryDinner: CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(59,130,246,0.45)",
    background: "rgba(59,130,246,0.85)",
    color: "#fff",
  };

  const isBusy = !!busy;

  const wsTitle = useMemo(() => {
    const ws = worksites.find((w) => w.id === selectedWorksiteId);
    if (!ws) return "";
    return `${ws.name}${ws.city ? ` - ${ws.city}` : ""}`;
  }, [worksites, selectedWorksiteId]);

  const cutoffText = useMemo(() => {
    if (!contract) return "-- / --";
    return `${contract.cutoff_lunch ?? "--"} / ${contract.cutoff_dinner ?? "--"}`;
  }, [contract]);

  const mismatchLunch = totalsNow.almoco !== totalsSaved.almoco;
  const mismatchDinner = totalsNow.janta !== totalsSaved.janta;

  if (!sessionUserId) {
    return (
      <div className="page-root">
        <div className="page-container">
          <div className="section-card" style={{ maxWidth: 520, margin: "0 auto" }}>
            <div className="section-header">
              <div>
                <div className="section-title">Refeições</div>
                <div className="section-subtitle">Login simples por e-mail (link mágico).</div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div className="filter-label">E-mail</div>
                <input
                  style={inputStyle}
                  placeholder="seuemail@empresa.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  inputMode="email"
                  autoComplete="email"
                />
              </div>

              <button
                style={{ ...btnPrimaryDinner, padding: "12px 12px", borderRadius: 14 }}
                onClick={sendMagicLink}
                disabled={!loginEmail.trim() || isBusy}
              >
                {busy ? busy : "Enviar link de acesso"}
              </button>

              {loginSent && <div style={{ fontSize: 13, color: "#166534" }}>Link enviado. Abra seu e-mail e clique para entrar.</div>}
              {toast && <div style={{ fontSize: 13, color: "#991b1b" }}>{toast}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root">
      <style jsx>{`
        .appPadBottom {
          padding-bottom: 98px;
        }
        .topWrap {
          display: grid;
          gap: 12px;
        }
        .filtersCard {
          border-radius: 22px;
          border: 1px solid rgba(229, 231, 235, 0.9);
          background: rgba(255, 255, 255, 0.85);
          padding: 14px;
        }
        .filtersGrid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 10px;
          align-items: end;
        }
        .filtersGrid2 {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          margin-top: 10px;
        }
        .cardsRow {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .miniRow {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        .bigCard {
          border-radius: 22px;
          border: 1px solid rgba(229, 231, 235, 0.9);
          background: rgba(255, 255, 255, 0.85);
          padding: 14px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.05);
        }
        .cardTitle {
          font-size: 12px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(107, 114, 128, 0.9);
          font-weight: 800;
        }
        .cardNum {
          font-size: 38px;
          font-weight: 900;
          line-height: 1;
          margin-top: 8px;
        }
        .cardSub {
          margin-top: 8px;
          font-size: 12px;
          color: rgba(107, 114, 128, 0.95);
          font-weight: 700;
        }
        .badgeRow {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .pill {
          font-size: 12px;
          font-weight: 800;
          border-radius: 999px;
          padding: 6px 10px;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.8);
        }
        .pillOn {
          border-color: rgba(17, 24, 39, 0.15);
          background: rgba(17, 24, 39, 0.04);
        }
        .seg {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .segBtn {
          border-radius: 999px;
          padding: 10px 12px;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.9);
          font-weight: 900;
          font-size: 13px;
        }
        .segBtnOnLunch {
          border-color: rgba(16, 185, 129, 0.45);
          background: rgba(16, 185, 129, 0.12);
          color: #065f46;
        }
        .segBtnOnDinner {
          border-color: rgba(59, 130, 246, 0.45);
          background: rgba(59, 130, 246, 0.12);
          color: #1d4ed8;
        }
        .segBtnOnBoth {
          border-color: rgba(17, 24, 39, 0.20);
          background: rgba(17, 24, 39, 0.06);
          color: #111827;
        }

        .markedStrip {
          display: flex;
          gap: 8px;
          flex-wrap: nowrap;
          overflow: auto;
          padding-bottom: 6px;
          margin-top: 10px;
        }
        .nameChip {
          white-space: nowrap;
          border-radius: 999px;
          padding: 7px 10px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.8);
        }

        .listWrap {
          margin-top: 10px;
          display: grid;
          gap: 10px;
        }

        .empCard {
          border-radius: 18px;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.92);
          padding: 12px;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.04);
        }
        .empHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }
        .empName {
          font-weight: 950;
          font-size: 16px;
          letter-spacing: 0.01em;
        }
        .empBadges {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .empBadge {
          font-size: 11px;
          padding: 5px 9px;
          border-radius: 999px;
          font-weight: 900;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.85);
        }
        .empBadgeFav {
          background: rgba(251, 146, 60, 0.14);
          border-color: rgba(251, 146, 60, 0.35);
          color: #9a3412;
        }
        .empBadgeThird {
          background: rgba(14, 165, 233, 0.10);
          border-color: rgba(14, 165, 233, 0.30);
          color: #075985;
        }
        .empBadgeOtherOnLunch {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.35);
          color: #065f46;
        }
        .empBadgeOtherOnDinner {
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.35);
          color: #1d4ed8;
        }

        .empActionCol {
          display: grid;
          gap: 10px;
        }
        .bigActionBtn {
          width: 100%;
          border-radius: 16px;
          padding: 14px 12px;
          font-weight: 950;
          font-size: 16px;
          border: 1px solid rgba(229, 231, 235, 0.95);
          background: rgba(255, 255, 255, 0.9);
          cursor: pointer;
        }

        .bottomBar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 30;
          background: rgba(255, 255, 255, 0.92);
          border-top: 1px solid rgba(229, 231, 235, 0.95);
          backdrop-filter: blur(8px);
        }
        .bottomInner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 10px 14px;
          display: grid;
          gap: 10px;
        }
        .bottomRow {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .bottomRow3 {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
        }
        .hintText {
          font-size: 12px;
          color: rgba(107, 114, 128, 0.9);
          font-weight: 700;
        }

        @media (min-width: 900px) {
          .topWrap {
            grid-template-columns: 1.2fr 0.8fr;
            align-items: start;
          }
          .filtersCard {
            position: sticky;
            top: 12px;
          }
          .cardsRow {
            grid-template-columns: 1fr 1fr;
          }
          .miniRow {
            grid-template-columns: 1fr 1fr;
          }
          .bottomInner {
            padding: 12px 18px;
          }
        }
      `}</style>

      <div className="page-container appPadBottom">
        <div className="page-header" style={{ marginBottom: 10 }}>
          <div className="brand">
            <div>
              <div className="brand-text-main">Refeições</div>
              <div className="brand-text-sub">Logado: {userEmail || sessionUserId}</div>
            </div>
          </div>

          <div className="header-right">
            <span className="header-pill">
              <span style={{ opacity: 0.75 }}>Data:</span> <b>{dateISO}</b>
            </span>
            <div style={{ marginTop: 8 }}>
              <button style={btnGhost} onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        </div>

        <div className="topWrap">
          {/* FILTERS */}
          <div className="filtersCard">
            <div className="filtersGrid">
              <div>
                <div className="filter-label">Obra</div>
                <select style={inputStyle} value={selectedWorksiteId} onChange={(e) => setSelectedWorksiteId(e.target.value)}>
                  {worksites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} {w.city ? `- ${w.city}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="filter-label">Data</div>
                <input type="date" style={inputStyle} value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
              </div>
            </div>

            <div className="filtersGrid2">
              <div>
                <div className="filter-label">Buscar</div>
                <input
                  style={inputStyle}
                  placeholder="Nome do funcionário..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <div className="seg">
                <button
                  className={`segBtn ${viewMode === "ALMOCO" ? "segBtnOnLunch" : ""}`}
                  onClick={() => setViewMode("ALMOCO")}
                  disabled={isBusy}
                >
                  {shiftEmoji("ALMOCO")} Almoço
                </button>
                <button
                  className={`segBtn ${viewMode === "JANTA" ? "segBtnOnDinner" : ""}`}
                  onClick={() => setViewMode("JANTA")}
                  disabled={isBusy}
                >
                  {shiftEmoji("JANTA")} Janta
                </button>
                <button
                  className={`segBtn ${viewMode === "AMBOS" ? "segBtnOnBoth" : ""}`}
                  onClick={() => setViewMode("AMBOS")}
                  disabled={isBusy}
                  title="Modo ambos turnos (use só se precisar)"
                >
                  Ambos
                </button>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
                  <input type="checkbox" checked={showOnlyMarked} onChange={(e) => setShowOnlyMarked(e.target.checked)} />
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>Mostrar só marcados</span>
                </label>

                <button style={btnGhost} onClick={() => setShowTools((v) => !v)} disabled={isBusy}>
                  {showTools ? "Fechar ferramentas" : "Ferramentas"}
                </button>
              </div>

              {showTools && (
                <div className="bigCard" style={{ padding: 12, boxShadow: "none" }}>
                  <div className="cardTitle">Ações rápidas</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <button style={btnGhost} onClick={copyYesterday} disabled={isBusy}>
                      Copiar ontem
                    </button>
                    <button style={btnGhost} onClick={() => copySummary("ALMOCO")} disabled={isBusy}>
                      Resumo Almoço
                    </button>
                    <button style={btnGhost} onClick={() => copySummary("JANTA")} disabled={isBusy}>
                      Resumo Janta
                    </button>
                    <button style={btnGhost} onClick={() => setShowAdd((v) => !v)} disabled={isBusy}>
                      {showAdd ? "Fechar" : "Adicionar pessoa"}
                    </button>
                    <button style={btnGhost} onClick={() => restoreSaved("ALMOCO")} disabled={isBusy || !orderLunch?.id}>
                      Restaurar salvo (Almoço)
                    </button>
                    <button style={btnGhost} onClick={() => restoreSaved("JANTA")} disabled={isBusy || !orderDinner?.id}>
                      Restaurar salvo (Janta)
                    </button>
                    <button style={btnDanger} onClick={clearAll} disabled={isBusy}>
                      Limpar tudo
                    </button>
                  </div>

                  <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                    {wsTitle} • {dateISO}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* DASH / TOTALS */}
          <div className="topWrapRight" style={{ display: "grid", gap: 12 }}>
            <div className="cardsRow">
              {/* Lunch card */}
              <div
                className="bigCard"
                style={{
                  borderColor: viewMode === "ALMOCO" ? "rgba(16,185,129,0.45)" : "rgba(229,231,235,0.95)",
                  background: viewMode === "ALMOCO" ? "rgba(16,185,129,0.06)" : "rgba(255,255,255,0.85)",
                }}
              >
                <div className="cardTitle">ALMOÇO</div>
                <div className="cardNum" style={{ color: "#065f46" }}>
                  {totalsNow.almoco}
                </div>
                <div className="cardSub">
                  Marcados agora{" "}
                  {mismatchLunch && orderLunch?.id ? (
                    <span style={{ color: "#b45309", fontWeight: 900 }}>• difere do salvo</span>
                  ) : null}
                </div>

                <div className="badgeRow">
                  <span className="pill pillOn" style={{ borderColor: "rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.10)", color: "#065f46" }}>
                    Salvo: {totalsSaved.almoco} {totalsSaved.lunchSaved ? "✅" : "—"}
                    {savedAt.ALMOCO ? ` • ${fmtHHMMFromISO(savedAt.ALMOCO)}` : ""}
                  </span>
                  {isShiftLocked("ALMOCO") && (
                    <span className="pill" style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#7f1d1d" }}>
                      Fechado (cutoff)
                    </span>
                  )}
                </div>
              </div>

              {/* Dinner card */}
              <div
                className="bigCard"
                style={{
                  borderColor: viewMode === "JANTA" ? "rgba(59,130,246,0.45)" : "rgba(229,231,235,0.95)",
                  background: viewMode === "JANTA" ? "rgba(59,130,246,0.06)" : "rgba(255,255,255,0.85)",
                }}
              >
                <div className="cardTitle">JANTA</div>
                <div className="cardNum" style={{ color: "#1d4ed8" }}>
                  {totalsNow.janta}
                </div>
                <div className="cardSub">
                  Marcados agora{" "}
                  {mismatchDinner && orderDinner?.id ? (
                    <span style={{ color: "#b45309", fontWeight: 900 }}>• difere do salvo</span>
                  ) : null}
                </div>

                <div className="badgeRow">
                  <span className="pill pillOn" style={{ borderColor: "rgba(59,130,246,0.35)", background: "rgba(59,130,246,0.10)", color: "#1d4ed8" }}>
                    Salvo: {totalsSaved.janta} {totalsSaved.dinnerSaved ? "✅" : "—"}
                    {savedAt.JANTA ? ` • ${fmtHHMMFromISO(savedAt.JANTA)}` : ""}
                  </span>
                  {isShiftLocked("JANTA") && (
                    <span className="pill" style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)", color: "#7f1d1d" }}>
                      Fechado (cutoff)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="miniRow">
              <div className="bigCard" style={{ padding: 14 }}>
                <div className="cardTitle">HORÁRIO LIMITE</div>
                <div style={{ marginTop: 8, fontSize: 22, fontWeight: 950, color: "#111827" }}>{cutoffText}</div>
                <div className="cardSub">Almoço / Janta</div>
                <div className="hintText" style={{ marginTop: 10 }}>
                  {contract?.allow_after_cutoff === false
                    ? "Este contrato NÃO permite salvar/cancelar após o limite."
                    : "Este contrato permite alterações após o limite."}
                </div>
              </div>

              <div className="bigCard" style={{ padding: 14 }}>
                <div className="cardTitle">CONFIRA (bate o olho)</div>
                <div className="hintText" style={{ marginTop: 8 }}>
                  {viewMode === "AMBOS"
                    ? `Marcados (almoço ou janta): ${activeSelectedNames.length}`
                    : `Marcados ${shiftLabel(activeShift).toLowerCase()}: ${activeSelectedNames.length}`}
                </div>
                <div className="markedStrip">
                  {activeSelectedNames.length === 0 ? (
                    <span className="nameChip" style={{ opacity: 0.75 }}>
                      — ninguém marcado —
                    </span>
                  ) : (
                    activeSelectedNames.slice(0, 12).map((n) => (
                      <span key={n} className="nameChip">
                        {n}
                      </span>
                    ))
                  )}
                  {activeSelectedNames.length > 12 && (
                    <span className="nameChip" style={{ opacity: 0.75 }}>
                      +{activeSelectedNames.length - 12}
                    </span>
                  )}
                </div>

                {copiedBanner && (
                  <div className="state-card" style={{ borderStyle: "dashed", marginTop: 10 }}>
                    {copiedBanner}
                  </div>
                )}
              </div>
            </div>

            {showAdd && (
              <div className="bigCard">
                <div className="cardTitle">ADICIONAR PESSOA</div>
                <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                  <div>
                    <div className="filter-label">Nome completo</div>
                    <input
                      style={inputStyle}
                      placeholder="Ex.: João da Silva"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>

                  <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input type="checkbox" checked={newIsThird} onChange={(e) => setNewIsThird(e.target.checked)} />
                    <span style={{ fontSize: 13, fontWeight: 900 }}>É terceiro</span>
                  </label>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <button style={btnGhost} onClick={() => setShowAdd(false)} disabled={isBusy}>
                      Cancelar
                    </button>
                    <button style={btnPrimaryDinner} onClick={addEmployee} disabled={isBusy}>
                      {busy ? busy : "Adicionar"}
                    </button>
                  </div>

                  {toast && <div style={{ fontSize: 13, color: "#991b1b" }}>{toast}</div>}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* LIST */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 950, color: "#111827" }}>Marcação</div>
              <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
                {viewMode === "AMBOS"
                  ? "Modo ambos (use só se precisar)."
                  : `Você está marcando: ${shiftLabel(activeShift).toUpperCase()} (um turno por vez).`}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {viewMode === "AMBOS" ? (
                <>
                  <button style={btnGhost} onClick={() => setAllShift("ALMOCO", true)} disabled={isBusy}>
                    Todos almoço
                  </button>
                  <button style={btnGhost} onClick={() => setAllShift("JANTA", true)} disabled={isBusy}>
                    Todos janta
                  </button>
                  <button style={btnDanger} onClick={clearAll} disabled={isBusy}>
                    Limpar
                  </button>
                </>
              ) : (
                <>
                  <button style={btnGhost} onClick={() => setAllShift(activeShift, true)} disabled={isBusy || isShiftLocked(activeShift)}>
                    Todos {shiftLabel(activeShift).toLowerCase()}
                  </button>
                  <button style={btnDanger} onClick={() => clearShift(activeShift)} disabled={isBusy || isShiftLocked(activeShift)}>
                    Limpar {shiftLabel(activeShift).toLowerCase()}
                  </button>
                </>
              )}
            </div>
          </div>

          {toast && (
            <div className="state-card" style={{ marginTop: 10 }}>
              {toast}
            </div>
          )}

          <div className="listWrap">
            {employeesVisible.map((e) => {
              const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
              const isFav = favoritesIds.has(e.id);

              const toneLunch = shiftTone("ALMOCO");
              const toneDinner = shiftTone("JANTA");

              const isOnLunch = p.ALMOCO;
              const isOnDinner = p.JANTA;

              // card background based on current view
              const cardBg =
                viewMode === "AMBOS"
                  ? isOnLunch && isOnDinner
                    ? "rgba(17,24,39,0.03)"
                    : isOnLunch
                    ? toneLunch.bgOn
                    : isOnDinner
                    ? toneDinner.bgOn
                    : "rgba(255,255,255,0.92)"
                  : activeShift === "ALMOCO"
                  ? isOnLunch
                    ? toneLunch.bgOn
                    : "rgba(255,255,255,0.92)"
                  : isOnDinner
                  ? toneDinner.bgOn
                  : "rgba(255,255,255,0.92)";

              const cardBd =
                viewMode === "AMBOS"
                  ? isOnLunch && isOnDinner
                    ? "rgba(17,24,39,0.14)"
                    : isOnLunch
                    ? toneLunch.bdOn
                    : isOnDinner
                    ? toneDinner.bdOn
                    : "rgba(229,231,235,0.95)"
                  : activeShift === "ALMOCO"
                  ? isOnLunch
                    ? toneLunch.bdOn
                    : "rgba(229,231,235,0.95)"
                  : isOnDinner
                  ? toneDinner.bdOn
                  : "rgba(229,231,235,0.95)";

              function bigBtnStyle(shift: Shift, isOn: boolean): CSSProperties {
                const tone = shiftTone(shift);
                return {
                  borderRadius: 16,
                  padding: "14px 12px",
                  width: "100%",
                  fontSize: 16,
                  fontWeight: 950,
                  border: `1px solid ${isOn ? tone.btnBd : "rgba(229,231,235,0.95)"}`,
                  background: isOn ? tone.btnOn : "rgba(255,255,255,0.92)",
                  color: isOn ? tone.btnTx : "#111827",
                  cursor: "pointer",
                };
              }

              const lockedLunch = isShiftLocked("ALMOCO");
              const lockedDinner = isShiftLocked("JANTA");

              return (
                <div key={e.id} className="empCard" style={{ background: cardBg, borderColor: cardBd }}>
                  <div className="empHead">
                    <div className="empName">{e.full_name}</div>
                    <div className="empBadges">
                      {isFav && <span className="empBadge empBadgeFav">favorito</span>}
                      {e.is_third_party && <span className="empBadge empBadgeThird">terceiro</span>}

                      {/* pequeno “status do outro turno” pra não confundir */}
                      {viewMode === "ALMOCO" && isOnDinner && <span className="empBadge empBadgeOtherOnDinner">Janta ✓</span>}
                      {viewMode === "JANTA" && isOnLunch && <span className="empBadge empBadgeOtherOnLunch">Almoço ✓</span>}
                    </div>
                  </div>

                  <div className="empActionCol">
                    {viewMode === "AMBOS" ? (
                      <>
                        <button
                          className="bigActionBtn"
                          style={bigBtnStyle("ALMOCO", isOnLunch)}
                          onClick={() => togglePick(e.id, "ALMOCO")}
                          disabled={isBusy || lockedLunch}
                        >
                          {isOnLunch ? "✓ Almoço" : "+ Almoço"}
                        </button>
                        <button
                          className="bigActionBtn"
                          style={bigBtnStyle("JANTA", isOnDinner)}
                          onClick={() => togglePick(e.id, "JANTA")}
                          disabled={isBusy || lockedDinner}
                        >
                          {isOnDinner ? "✓ Janta" : "+ Janta"}
                        </button>
                        {(lockedLunch || lockedDinner) && (
                          <div className="hintText">Fechado por cutoff (contrato não permite após limite).</div>
                        )}
                      </>
                    ) : (
                      <button
                        className="bigActionBtn"
                        style={bigBtnStyle(activeShift, p[activeShift])}
                        onClick={() => togglePick(e.id, activeShift)}
                        disabled={isBusy || isShiftLocked(activeShift)}
                      >
                        {p[activeShift] ? `✓ ${shiftLabel(activeShift)}` : `+ ${shiftLabel(activeShift)}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {employeesVisible.length === 0 && (
              <div className="bigCard" style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 900, color: "#111827" }}>Nenhum funcionário encontrado.</div>
                <div className="hintText" style={{ marginTop: 6 }}>
                  Tente limpar a busca ou desmarcar “Mostrar só marcados”.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM BAR (thumb-friendly) */}
      <div className="bottomBar">
        <div className="bottomInner">
          {viewMode === "AMBOS" ? (
            <>
              <div className="bottomRow3">
                <button style={btnDanger} onClick={() => cancelShift("ALMOCO")} disabled={isBusy || !orderLunch?.id || isShiftLocked("ALMOCO")}>
                  Cancelar Almoço
                </button>
                <button style={btnDanger} onClick={() => cancelShift("JANTA")} disabled={isBusy || !orderDinner?.id || isShiftLocked("JANTA")}>
                  Cancelar Janta
                </button>
                <button style={btnDanger} onClick={clearAll} disabled={isBusy}>
                  Limpar
                </button>
              </div>
              <div className="bottomRow">
                <button style={btnPrimaryLunch} onClick={() => saveShift("ALMOCO")} disabled={isBusy || !selectedWorksiteId || !contract || isShiftLocked("ALMOCO")}>
                  {busy?.includes("almoço") ? busy : "Salvar Almoço"}
                </button>
                <button style={btnPrimaryDinner} onClick={() => saveShift("JANTA")} disabled={isBusy || !selectedWorksiteId || !contract || isShiftLocked("JANTA")}>
                  {busy?.includes("janta") ? busy : "Salvar Janta"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="bottomRow3">
                <button
                  style={btnDanger}
                  onClick={() => cancelShift(activeShift)}
                  disabled={isBusy || (activeShift === "ALMOCO" ? !orderLunch?.id : !orderDinner?.id) || isShiftLocked(activeShift)}
                >
                  Cancelar {shiftLabel(activeShift)}
                </button>
                <button style={btnDanger} onClick={() => clearShift(activeShift)} disabled={isBusy || isShiftLocked(activeShift)}>
                  Limpar
                </button>
                <button
                  style={btnGhost}
                  onClick={() => restoreSaved(activeShift)}
                  disabled={isBusy || (activeShift === "ALMOCO" ? !orderLunch?.id : !orderDinner?.id)}
                >
                  Restaurar salvo
                </button>
              </div>

              <div className="bottomRow">
                <button
                  style={activeShift === "ALMOCO" ? btnPrimaryLunch : btnPrimaryDinner}
                  onClick={() => saveShift(activeShift)}
                  disabled={isBusy || !selectedWorksiteId || !contract || isShiftLocked(activeShift)}
                >
                  {busy ? busy : `Salvar ${shiftLabel(activeShift)}`}
                </button>

                <button style={btnGhost} onClick={() => copySummary(activeShift)} disabled={isBusy}>
                  Copiar resumo
                </button>
              </div>
            </>
          )}

          <div className="hintText">
            {wsTitle ? `${wsTitle} • ` : ""}
            {dateISO}
          </div>
        </div>
      </div>
    </div>
  );
}

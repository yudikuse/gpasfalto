// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type ViewMode = "AMBOS" | "ALMOCO" | "JANTA";

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
  closed_at?: string | null;
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

function setEq(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

export default function RefeicoesPage() {
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string>("");

  const [loginEmail, setLoginEmail] = useState<string>("");
  const [loginSent, setLoginSent] = useState<boolean>(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [selectedWorksiteId, setSelectedWorksiteId] = useState<string>("");
  const [dateISO, setDateISO] = useState<string>(isoLocalToday());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [favoritesIds, setFavoritesIds] = useState<Set<string>>(new Set());

  const [contract, setContract] = useState<Contract | null>(null);

  const [orderLunch, setOrderLunch] = useState<Order | null>(null);
  const [orderDinner, setOrderDinner] = useState<Order | null>(null);

  const [savedLunchSet, setSavedLunchSet] = useState<Set<string>>(new Set());
  const [savedDinnerSet, setSavedDinnerSet] = useState<Set<string>>(new Set());

  const [picks, setPicks] = useState<Record<string, Pick>>({});

  // UI
  const [search, setSearch] = useState<string>("");
  const [viewMode, setViewMode] = useState<ViewMode>("AMBOS");
  const [showOnlyMarked, setShowOnlyMarked] = useState<boolean>(false);

  const [showAdd, setShowAdd] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>("");
  const [newIsThird, setNewIsThird] = useState<boolean>(false);

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

  // load worksites + employees
  useEffect(() => {
    if (!sessionUserId) return;

    (async () => {
      setBusy("Carregando obras e equipe...");
      setToast(null);

      const [wsRes, empRes] = await Promise.all([
        supabase
          .from("meal_worksites")
          .select("id,name,city,active")
          .eq("active", true)
          .order("name", { ascending: true }),
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

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  // load favorites + contract + orders + lines
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
        setSavedLunchSet(new Set());
        setSavedDinnerSet(new Set());

        const empty: Record<string, Pick> = {};
        for (const e of employees) empty[e.id] = { ALMOCO: false, JANTA: false };
        setPicks(empty);

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
          .select("id,restaurant_id,status,shift,closed_at,created_at")
          .eq("worksite_id", selectedWorksiteId)
          .eq("meal_date", dateISO)
          .eq("shift", shift)
          .order("created_at", { ascending: false })
          .limit(1);

        if (oRes.error) return { error: oRes.error, order: null as Order | null };
        const o = (oRes.data?.[0] ?? null) as Order | null;
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

      async function getLineSet(orderId: string | undefined | null) {
        if (!orderId) return new Set<string>();
        const lRes = await supabase
          .from("meal_order_lines")
          .select("employee_id,included")
          .eq("meal_order_id", orderId);

        if (lRes.error) throw new Error(lRes.error.message);
        const rows = (lRes.data ?? []) as any[];
        const s = new Set<string>();
        for (const r of rows) {
          if (r.included === false) continue;
          if (r.employee_id) s.add(String(r.employee_id));
        }
        return s;
      }

      try {
        const [setLunch, setDinner] = await Promise.all([
          getLineSet(lunch.order?.id),
          getLineSet(dinner.order?.id),
        ]);

        // se pedido estiver cancelado, tratamos como "não salvo"
        const lunchCancelled = (lunch.order?.status ?? "") === "CANCELLED";
        const dinnerCancelled = (dinner.order?.status ?? "") === "CANCELLED";

        setSavedLunchSet(lunchCancelled ? new Set() : setLunch);
        setSavedDinnerSet(dinnerCancelled ? new Set() : setDinner);

        const map: Record<string, Pick> = {};
        for (const e of employees) {
          map[e.id] = {
            ALMOCO: lunchCancelled ? false : setLunch.has(e.id),
            JANTA: dinnerCancelled ? false : setDinner.has(e.id),
          };
        }
        setPicks(map);

        setBusy(null);
      } catch (e: any) {
        setBusy(null);
        setToast(`Erro itens: ${e?.message ?? "falha ao carregar itens"}`);
      }
    })();
  }, [sessionUserId, selectedWorksiteId, dateISO, employees]);

  const wsLabel = useMemo(() => {
    const ws = worksites.find((w) => w.id === selectedWorksiteId);
    if (!ws) return "";
    return `${ws.name}${ws.city ? ` - ${ws.city}` : ""}`;
  }, [worksites, selectedWorksiteId]);

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

    const ordered = [...fav, ...normal, ...third];

    if (!showOnlyMarked) return ordered;

    return ordered.filter((e) => {
      const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
      if (viewMode === "ALMOCO") return !!p.ALMOCO;
      if (viewMode === "JANTA") return !!p.JANTA;
      return !!p.ALMOCO || !!p.JANTA;
    });
  }, [employees, favoritesIds, search, showOnlyMarked, picks, viewMode]);

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
    return { almoco: savedLunchSet.size, janta: savedDinnerSet.size };
  }, [savedLunchSet, savedDinnerSet]);

  const changedLunch = useMemo(() => {
    const cur = new Set<string>();
    for (const e of employees) if (picks[e.id]?.ALMOCO) cur.add(e.id);
    return !setEq(cur, savedLunchSet);
  }, [employees, picks, savedLunchSet]);

  const changedDinner = useMemo(() => {
    const cur = new Set<string>();
    for (const e of employees) if (picks[e.id]?.JANTA) cur.add(e.id);
    return !setEq(cur, savedDinnerSet);
  }, [employees, picks, savedDinnerSet]);

  async function sendMagicLink() {
    const email = loginEmail.trim().toLowerCase();
    if (!email) return;

    setBusy("Enviando link...");
    setToast(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/refeicoes` },
    });

    setBusy(null);
    if (error) setToast(`Erro login: ${error.message}`);
    else setLoginSent(true);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  function togglePick(empId: string, shift: Shift) {
    setPicks((prev) => ({
      ...prev,
      [empId]: {
        ...(prev[empId] ?? { ALMOCO: false, JANTA: false }),
        [shift]: !(prev[empId]?.[shift] ?? false),
      },
    }));
  }

  function setAll(shift: Shift, value: boolean) {
    setPicks((prev) => {
      const next: Record<string, Pick> = { ...prev };
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
      for (const key of Object.keys(next)) next[key] = { ...next[key], [shift]: false };
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

  function restoreSaved(shift: Shift | "AMBOS") {
    setPicks((prev) => {
      const next: Record<string, Pick> = { ...prev };
      for (const e of employees) {
        const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
        next[e.id] = {
          ALMOCO: shift === "JANTA" ? cur.ALMOCO : savedLunchSet.has(e.id),
          JANTA: shift === "ALMOCO" ? cur.JANTA : savedDinnerSet.has(e.id),
        };
      }
      return next;
    });
    setToast("Restaurado do salvo ✅");
    setTimeout(() => setToast(null), 1200);
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
      const lRes = await supabase
        .from("meal_order_lines")
        .select("employee_id,included")
        .eq("meal_order_id", orderId);

      if (lRes.error) throw new Error(lRes.error.message);
      const s = new Set<string>();
      for (const r of (lRes.data ?? []) as any[]) {
        if (r.included === false) continue;
        s.add(String(r.employee_id));
      }
      return s;
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
      for (const e of employees) map[e.id] = { ALMOCO: setLunch.has(e.id), JANTA: setDinner.has(e.id) };

      setPicks(map);
      setBusy(null);
      setToast("Copiado do dia anterior (ainda não salvo).");
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro copiar: ${e?.message ?? "falha"}`);
    }
  }

  async function ensureOrder(shift: Shift): Promise<Order | null> {
    if (!selectedWorksiteId || !contract) return null;

    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;

    if (existing?.id) {
      // reativa se estava cancelado
      const payload: any = { restaurant_id: contract.restaurant_id };
      if ((existing.status ?? "") === "CANCELLED") {
        payload.status = "DRAFT";
        payload.closed_at = null;
      }

      const upd = await supabase.from("meal_orders").update(payload).eq("id", existing.id);
      if (upd.error) throw new Error(upd.error.message);

      const next: Order = { ...existing, restaurant_id: contract.restaurant_id, ...(payload.status ? { status: payload.status } : {}) };
      if (shift === "ALMOCO") setOrderLunch(next);
      else setOrderDinner(next);

      return next;
    }

    const ins = await supabase
      .from("meal_orders")
      .insert({
        worksite_id: selectedWorksiteId,
        restaurant_id: contract.restaurant_id,
        meal_date: dateISO,
        order_date: dateISO, // compat com view
        shift,
        status: "DRAFT",
      })
      .select("id,restaurant_id,status,shift,closed_at")
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

    const late = shift === "ALMOCO" ? nowAfterCutoff(contract.cutoff_lunch) : nowAfterCutoff(contract.cutoff_dinner);
    if (late && contract.allow_after_cutoff === false) {
      setToast("Atenção: passou do horário e esse contrato não permite após cutoff.");
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

      // remove linhas antigas
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", order.id);
      if (del.error) throw new Error(del.error.message);

      // cria linhas novas
      const rows: any[] = [];
      for (const e of employees) {
        const p = picks[e.id];
        if (!p) continue;
        if (shift === "ALMOCO" && p.ALMOCO) rows.push({ meal_order_id: order.id, employee_id: e.id, included: true });
        if (shift === "JANTA" && p.JANTA) rows.push({ meal_order_id: order.id, employee_id: e.id, included: true });
      }

      if (rows.length > 0) {
        const insLines = await supabase.from("meal_order_lines").insert(rows);
        if (insLines.error) throw new Error(insLines.error.message);
      }

      // atualiza "salvo" local
      if (shift === "ALMOCO") {
        const s = new Set<string>();
        for (const e of employees) if (picks[e.id]?.ALMOCO) s.add(e.id);
        setSavedLunchSet(s);
        setOrderLunch((prev) => (prev ? { ...prev, status: "DRAFT" } : prev));
      } else {
        const s = new Set<string>();
        for (const e of employees) if (picks[e.id]?.JANTA) s.add(e.id);
        setSavedDinnerSet(s);
        setOrderDinner((prev) => (prev ? { ...prev, status: "DRAFT" } : prev));
      }

      setBusy(null);
      setToast(shift === "ALMOCO" ? "Almoço salvo ✅" : "Janta salva ✅");
      setTimeout(() => setToast(null), 1400);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro salvar: ${e?.message ?? "falha"}`);
    }
  }

  async function cancelShift(shift: Shift) {
    const order = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (!order?.id) {
      setToast("Não há pedido salvo para cancelar.");
      setTimeout(() => setToast(null), 1200);
      return;
    }

    // travar se já fechou
    const isClosed = !!order.closed_at || (order.status ?? "") === "CLOSED";
    if (isClosed) {
      setToast("Pedido já foi fechado. Cancelamento bloqueado.");
      setTimeout(() => setToast(null), 1400);
      return;
    }

    const ok = window.confirm(`Cancelar ${shift === "ALMOCO" ? "ALMOÇO" : "JANTA"} deste dia?\n\nIsso vai zerar os itens e marcar como CANCELADO.`);
    if (!ok) return;

    setBusy(shift === "ALMOCO" ? "Cancelando almoço..." : "Cancelando janta...");
    setToast(null);

    try {
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", order.id);
      if (del.error) throw new Error(del.error.message);

      const upd = await supabase.from("meal_orders").update({ status: "CANCELLED" }).eq("id", order.id);
      if (upd.error) throw new Error(upd.error.message);

      // zera local
      if (shift === "ALMOCO") {
        setSavedLunchSet(new Set());
        setOrderLunch((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
        clearShift("ALMOCO");
      } else {
        setSavedDinnerSet(new Set());
        setOrderDinner((prev) => (prev ? { ...prev, status: "CANCELLED" } : prev));
        clearShift("JANTA");
      }

      setBusy(null);
      setToast(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado ✅`);
      setTimeout(() => setToast(null), 1400);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro cancelar: ${e?.message ?? "falha"}`);
    }
  }

  function buildSummary(mode: Shift | "AMBOS") {
    const cutoff = contract
      ? `Horário limite: Almoço ${contract.cutoff_lunch ?? "--"} | Janta ${contract.cutoff_dinner ?? "--"}`
      : "";

    const pickLunch = employeesOrdered
      .filter((e) => picks[e.id]?.ALMOCO)
      .map((e) => `- ${e.full_name}${e.is_third_party ? " (terceiro)" : ""}`);

    const pickDinner = employeesOrdered
      .filter((e) => picks[e.id]?.JANTA)
      .map((e) => `- ${e.full_name}${e.is_third_party ? " (terceiro)" : ""}`);

    const head = `Refeições • ${wsLabel || selectedWorksiteId} • ${dateISO}\n${cutoff ? cutoff + "\n" : ""}\n`;

    if (mode === "ALMOCO") {
      return head + `Pedido: ALMOÇO\nQtde: ${pickLunch.length}\n\nALMOÇO:\n` + (pickLunch.length ? pickLunch.join("\n") : "- (ninguém marcado)");
    }
    if (mode === "JANTA") {
      return head + `Pedido: JANTA\nQtde: ${pickDinner.length}\n\nJANTA:\n` + (pickDinner.length ? pickDinner.join("\n") : "- (ninguém marcado)");
    }

    return (
      head +
      `ALMOÇO (qtde ${pickLunch.length}):\n` +
      (pickLunch.length ? pickLunch.join("\n") : "- (ninguém marcado)") +
      `\n\nJANTA (qtde ${pickDinner.length}):\n` +
      (pickDinner.length ? pickDinner.join("\n") : "- (ninguém marcado)")
    );
  }

  async function copySummary() {
    const text = buildSummary(viewMode === "AMBOS" ? "AMBOS" : (viewMode as Shift));
    const ok = await copyToClipboard(text);
    setCopiedBanner(ok ? "Resumo copiado ✅ (cole no WhatsApp)" : "Falha ao copiar 😕");
    setTimeout(() => setCopiedBanner(null), 2200);
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
    setTimeout(() => setToast(null), 1400);
  }

  const canCancelLunch = !!orderLunch?.id && (orderLunch.status ?? "") !== "CANCELLED" && !(orderLunch.closed_at);
  const canCancelDinner = !!orderDinner?.id && (orderDinner.status ?? "") !== "CANCELLED" && !(orderDinner.closed_at);

  const showSaveLunch = viewMode === "AMBOS" || viewMode === "ALMOCO";
  const showSaveDinner = viewMode === "AMBOS" || viewMode === "JANTA";

  const restoreEnabled =
    (viewMode === "AMBOS" && (changedLunch || changedDinner)) ||
    (viewMode === "ALMOCO" && changedLunch) ||
    (viewMode === "JANTA" && changedDinner);

  if (!sessionUserId) {
    return (
      <div className="m-root">
        <div className="m-wrap">
          <div className="m-card" style={{ maxWidth: 560, margin: "0 auto" }}>
            <div className="m-head">
              <div className="m-brand">
                <img className="m-logo" src="/logo-gp-asfalto.png" alt="Logo" onError={(e) => ((e.currentTarget.style.display = "none"))} />
                <div>
                  <div className="m-title">Refeições</div>
                  <div className="m-sub">Login simples por e-mail (link mágico).</div>
                </div>
              </div>
            </div>

            <div className="m-form">
              <div>
                <div className="m-label">E-mail</div>
                <input
                  className="m-input"
                  placeholder="seuemail@empresa.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  inputMode="email"
                  autoComplete="email"
                />
              </div>

              <button className="m-btn m-btnPrimary" onClick={sendMagicLink} disabled={!loginEmail.trim() || !!busy}>
                {busy ? busy : "Enviar link de acesso"}
              </button>

              {loginSent && <div className="m-ok">Link enviado. Abra seu e-mail e clique para entrar.</div>}
              {toast && <div className="m-err">{toast}</div>}
            </div>
          </div>
        </div>

        <style jsx global>{css}</style>
      </div>
    );
  }

  return (
    <div className="m-root">
      <div className="m-wrap">
        {/* header */}
        <div className="m-top">
          <div className="m-brand">
            <img className="m-logo" src="/logo-gp-asfalto.png" alt="Logo" onError={(e) => ((e.currentTarget.style.display = "none"))} />
            <div>
              <div className="m-title">Refeições</div>
              <div className="m-sub">Logado: {userEmail || sessionUserId}</div>
            </div>
          </div>

          <div className="m-topRight">
            <div className="m-pill">Data: <b>{dateISO}</b></div>
            <button className="m-btn m-btnGhost" onClick={logout}>Sair</button>
          </div>
        </div>

        {/* filters */}
        <div className="m-card m-filter">
          <div>
            <div className="m-label">Obra</div>
            <select className="m-input" value={selectedWorksiteId} onChange={(e) => setSelectedWorksiteId(e.target.value)}>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.city ? `- ${w.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="m-label">Data</div>
            <input type="date" className="m-input" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>

          <div className="m-filterSearch">
            <div className="m-label">Buscar</div>
            <input className="m-input" placeholder="Nome do funcionário..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {/* summary */}
        <div className="m-grid3">
          <div className="m-card">
            <div className="m-kicker">Totais do dia</div>
            <div className="m-big">{totalsSaved.almoco} / {totalsSaved.janta}</div>
            <div className="m-sub2">Já pedido (salvo) • Almoço / Janta</div>
            <div className="m-miniRow">
              <span className={`m-chip ${orderLunch?.status === "CANCELLED" ? "m-chipOff" : "m-chipOn"}`}>
                Almoço: {orderLunch?.status === "CANCELLED" ? "cancelado" : "salvo"}
              </span>
              <span className={`m-chip ${orderDinner?.status === "CANCELLED" ? "m-chipOff" : "m-chipOn"}`}>
                Janta: {orderDinner?.status === "CANCELLED" ? "cancelado" : "salvo"}
              </span>
            </div>
          </div>

          <div className="m-card">
            <div className="m-kicker">Horário limite</div>
            <div className="m-bigSm">{contract ? `${contract.cutoff_lunch ?? "--"} / ${contract.cutoff_dinner ?? "--"}` : "-- / --"}</div>
            <div className="m-sub2">Almoço / Janta</div>
            <div className="m-sub3">
              {contract?.allow_after_cutoff === false ? "Contrato não permite após o limite." : "Contrato permite após o limite."}
            </div>
          </div>

          <div className="m-card">
            <div className="m-kicker">Ações rápidas</div>
            <div className="m-actions">
              <button className="m-btn m-btnGhost" onClick={copyYesterday} disabled={!!busy}>Copiar ontem</button>
              <button className="m-btn m-btnGhost" onClick={copySummary} disabled={!!busy}>Copiar resumo</button>
              <button className="m-btn m-btnGhost" onClick={() => setShowAdd((v) => !v)} disabled={!!busy}>
                {showAdd ? "Fechar" : "Adicionar pessoa"}
              </button>
            </div>
            <div className="m-sub3">{wsLabel} • {dateISO}</div>
          </div>
        </div>

        {copiedBanner && <div className="m-banner">{copiedBanner}</div>}
        {toast && <div className={`m-banner ${toast.toLowerCase().includes("erro") ? "m-bannerErr" : ""}`}>{toast}</div>}

        {showAdd && (
          <div className="m-card">
            <div className="m-rowBetween">
              <div>
                <div className="m-kicker">Adicionar pessoa</div>
                <div className="m-sub2">Funcionário fixo ou terceiro.</div>
              </div>
              <button className="m-btn m-btnGhost" onClick={() => setShowAdd(false)} disabled={!!busy}>Fechar</button>
            </div>

            <div className="m-addGrid">
              <div>
                <div className="m-label">Nome completo</div>
                <input className="m-input" placeholder="Ex.: João da Silva" value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>

              <label className="m-check">
                <input type="checkbox" checked={newIsThird} onChange={(e) => setNewIsThird(e.target.checked)} />
                <span>É terceiro</span>
              </label>
            </div>

            <div className="m-rowEnd">
              <button className="m-btn m-btnPrimary" onClick={addEmployee} disabled={!!busy}>
                {busy ? busy : "Adicionar"}
              </button>
            </div>
          </div>
        )}

        {/* now boxes (super rápido no celular) */}
        <div className="m-grid2">
          <div className="m-card m-nowLunch">
            <div className="m-kicker">Almoço (marcados agora)</div>
            <div className="m-big">{totalsNow.almoco}</div>
            <div className="m-sub2">{totalsNow.almoco ? " " : "— ninguém marcado —"}</div>
          </div>
          <div className="m-card m-nowDinner">
            <div className="m-kicker">Janta (marcados agora)</div>
            <div className="m-big">{totalsNow.janta}</div>
            <div className="m-sub2">{totalsNow.janta ? " " : "— ninguém marcado —"}</div>
          </div>
        </div>

        {/* controls */}
        <div className="m-card">
          <div className="m-rowBetween">
            <div>
              <div className="m-kicker">Marcação</div>
              <div className="m-sub2">Visual pensado pro celular: botões grandes e cores por turno.</div>
            </div>

            <label className="m-check">
              <input type="checkbox" checked={showOnlyMarked} onChange={(e) => setShowOnlyMarked(e.target.checked)} />
              <span>Mostrar só marcados</span>
            </label>
          </div>

          <div className="m-tabs">
            <button className={`m-tab ${viewMode === "AMBOS" ? "m-tabOn" : ""}`} onClick={() => setViewMode("AMBOS")}>Ambos</button>
            <button className={`m-tab ${viewMode === "ALMOCO" ? "m-tabOn" : ""}`} onClick={() => setViewMode("ALMOCO")}>Almoço</button>
            <button className={`m-tab ${viewMode === "JANTA" ? "m-tabOn" : ""}`} onClick={() => setViewMode("JANTA")}>Janta</button>
          </div>

          <div className="m-bulk">
            {(viewMode === "AMBOS" || viewMode === "ALMOCO") && (
              <button className="m-btn m-btnGhost" onClick={() => setAll("ALMOCO", true)} disabled={!!busy}>Todos almoço</button>
            )}
            {(viewMode === "AMBOS" || viewMode === "JANTA") && (
              <button className="m-btn m-btnGhost" onClick={() => setAll("JANTA", true)} disabled={!!busy}>Todos janta</button>
            )}
            <button className="m-btn m-btnDanger" onClick={() => (viewMode === "ALMOCO" ? clearShift("ALMOCO") : viewMode === "JANTA" ? clearShift("JANTA") : clearAll())} disabled={!!busy}>
              Limpar
            </button>
          </div>
        </div>

        {/* list */}
        <div className="m-list">
          {employeesOrdered.map((e) => {
            const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
            const isFav = favoritesIds.has(e.id);

            const showLunchBtn = viewMode === "AMBOS" || viewMode === "ALMOCO";
            const showDinnerBtn = viewMode === "AMBOS" || viewMode === "JANTA";

            const any = (showLunchBtn && p.ALMOCO) || (showDinnerBtn && p.JANTA) || (viewMode === "AMBOS" && (p.ALMOCO || p.JANTA));
            const cardClass = any ? "m-empCard m-empOn" : "m-empCard";

            return (
              <div key={e.id} className={cardClass}>
                <div className="m-empTop">
                  <div className="m-empName">{e.full_name}</div>
                  <div className="m-empChips">
                    {isFav && <span className="m-tag m-tagFav">favorito</span>}
                    {e.is_third_party && <span className="m-tag m-tagThird">terceiro</span>}
                  </div>
                </div>

                <div className="m-empBtns">
                  {showLunchBtn && (
                    <button
                      className={`m-shiftBtn m-lunch ${p.ALMOCO ? "m-shiftOn" : ""}`}
                      onClick={() => togglePick(e.id, "ALMOCO")}
                      disabled={!!busy}
                    >
                      {p.ALMOCO ? "✓ Almoço" : "+ Almoço"}
                    </button>
                  )}

                  {showDinnerBtn && (
                    <button
                      className={`m-shiftBtn m-dinner ${p.JANTA ? "m-shiftOn" : ""}`}
                      onClick={() => togglePick(e.id, "JANTA")}
                      disabled={!!busy}
                    >
                      {p.JANTA ? "✓ Janta" : "+ Janta"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {employeesOrdered.length === 0 && <div className="m-empty">Nenhum funcionário encontrado.</div>}
        </div>

        {/* bottom bar */}
        <div className="m-bottom">
          <div className="m-bottomInner">
            <div className="m-bottomRow">
              {(viewMode === "AMBOS" || viewMode === "ALMOCO") && (
                <button className="m-btn m-btnDanger" onClick={() => cancelShift("ALMOCO")} disabled={!!busy || !canCancelLunch}>
                  Cancelar Almoço
                </button>
              )}

              <button className="m-btn m-btnGhost" onClick={() => restoreSaved(viewMode === "AMBOS" ? "AMBOS" : (viewMode as Shift))} disabled={!!busy || !restoreEnabled}>
                Restaurar salvo
              </button>

              <button className="m-btn m-btnGhost" onClick={copySummary} disabled={!!busy}>
                Copiar resumo
              </button>
            </div>

            <div className="m-bottomRow">
              {showSaveLunch && (
                <button className="m-btn m-btnLunch" onClick={() => saveShift("ALMOCO")} disabled={!!busy || !selectedWorksiteId}>
                  {busy?.includes("almoço") ? busy : (changedLunch ? "Salvar Almoço" : "Salvar Almoço")}
                </button>
              )}

              {showSaveDinner && (
                <button className="m-btn m-btnDinner" onClick={() => saveShift("JANTA")} disabled={!!busy || !selectedWorksiteId}>
                  {busy?.includes("janta") ? busy : (changedDinner ? "Salvar Janta" : "Salvar Janta")}
                </button>
              )}

              {(viewMode === "AMBOS" || viewMode === "JANTA") && (
                <button className="m-btn m-btnDanger" onClick={() => cancelShift("JANTA")} disabled={!!busy || !canCancelDinner}>
                  Cancelar Janta
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{css}</style>
    </div>
  );
}

const css = `
.m-root{min-height:100vh;background:#f5f6f8;}
.m-wrap{max-width:1040px;margin:0 auto;padding:18px 14px 120px;}
.m-card{background:#fff;border:1px solid #e8eaee;border-radius:22px;box-shadow:0 10px 24px rgba(0,0,0,.05);padding:14px;}
.m-top{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:14px;}
.m-brand{display:flex;align-items:center;gap:12px;}
.m-logo{width:44px;height:44px;border-radius:12px;object-fit:contain;background:#fff;border:1px solid #e8eaee;padding:6px;}
.m-title{font-size:34px;line-height:1.05;font-weight:900;color:#111827;}
.m-sub{font-size:13px;color:#6b7280;margin-top:3px;}
.m-topRight{display:flex;flex-direction:column;align-items:flex-end;gap:8px;}
.m-pill{background:#fff;border:1px solid #e8eaee;border-radius:999px;padding:8px 12px;font-size:13px;color:#374151;box-shadow:0 10px 24px rgba(0,0,0,.05);}
.m-kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;font-weight:800;}
.m-big{font-size:44px;font-weight:950;color:#111827;margin-top:6px;}
.m-bigSm{font-size:26px;font-weight:950;color:#111827;margin-top:6px;}
.m-sub2{font-size:13px;color:#6b7280;margin-top:2px;}
.m-sub3{font-size:12px;color:#6b7280;margin-top:8px;}
.m-miniRow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}
.m-chip{font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid #e8eaee;background:#f9fafb;color:#374151;font-weight:800;}
.m-chipOn{border-color:rgba(16,185,129,.35);background:rgba(16,185,129,.08);color:#065f46;}
.m-chipOff{border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.06);color:#7f1d1d;}
.m-filter{display:grid;grid-template-columns:1.2fr .7fr 1.1fr;gap:10px;margin:12px 0;}
.m-filterSearch{min-width:220px;}
.m-label{font-size:12px;color:#6b7280;font-weight:800;margin-bottom:6px;letter-spacing:.06em;text-transform:uppercase;}
.m-input{width:100%;border-radius:16px;border:1px solid #e8eaee;padding:12px 12px;background:#fff;outline:none;font-size:14px;}
.m-input:focus{border-color:rgba(59,130,246,.35);box-shadow:0 0 0 3px rgba(59,130,246,.10);}
.m-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:12px 0;}
.m-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0;}
.m-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
.m-tabs{display:flex;gap:10px;justify-content:center;margin-top:12px;}
.m-tab{border:1px solid #e8eaee;background:#fff;border-radius:999px;padding:10px 14px;font-weight:900;font-size:14px;color:#2563eb;cursor:pointer;}
.m-tabOn{background:rgba(59,130,246,.10);border-color:rgba(59,130,246,.25);color:#1d4ed8;}
.m-bulk{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:12px;}
.m-btn{border-radius:999px;border:1px solid #e8eaee;padding:10px 14px;background:#fff;cursor:pointer;font-size:13px;font-weight:900;color:#111827;}
.m-btn:disabled{opacity:.45;cursor:not-allowed;}
.m-btnGhost{background:#fff;}
.m-btnPrimary{background:rgba(255,75,43,.95);border-color:rgba(255,75,43,.25);color:#fff;}
.m-btnDanger{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.25);color:#7f1d1d;}
.m-btnLunch{background:rgba(16,185,129,.92);border-color:rgba(16,185,129,.25);color:#fff;}
.m-btnDinner{background:rgba(59,130,246,.92);border-color:rgba(59,130,246,.25);color:#fff;}
.m-banner{margin:10px 0;padding:12px 14px;border-radius:18px;border:1px dashed #e8eaee;background:#fff;font-weight:800;color:#111827;}
.m-bannerErr{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.06);color:#7f1d1d;}
.m-nowLunch{border-color:rgba(16,185,129,.25);background:rgba(16,185,129,.06);}
.m-nowDinner{border-color:rgba(59,130,246,.25);background:rgba(59,130,246,.06);}
.m-list{display:grid;gap:12px;margin-top:12px;}
.m-empCard{background:#fff;border:1px solid #e8eaee;border-radius:22px;box-shadow:0 10px 24px rgba(0,0,0,.05);padding:14px;}
.m-empOn{border-color:rgba(17,24,39,.08);background:linear-gradient(180deg, rgba(249,250,251,.8), rgba(255,255,255,1));}
.m-empTop{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;}
.m-empName{font-size:15px;font-weight:950;color:#111827;}
.m-empChips{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.m-tag{font-size:12px;padding:6px 10px;border-radius:999px;font-weight:900;border:1px solid #e8eaee;background:#f9fafb;color:#374151;}
.m-tagFav{border-color:#fed7aa;background:#fff7ed;color:#9a3412;}
.m-tagThird{border-color:#bae6fd;background:#eff6ff;color:#075985;}
.m-empBtns{display:grid;gap:10px;grid-template-columns:1fr 1fr;}
.m-shiftBtn{width:100%;padding:14px 14px;border-radius:18px;border:2px solid transparent;font-weight:950;font-size:16px;cursor:pointer;}
.m-lunch{background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.25);color:#065f46;}
.m-dinner{background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.25);color:#1d4ed8;}
.m-shiftOn.m-lunch{background:rgba(16,185,129,.18);border-color:rgba(16,185,129,.45);}
.m-shiftOn.m-dinner{background:rgba(59,130,246,.18);border-color:rgba(59,130,246,.45);}
.m-empty{padding:18px;text-align:center;color:#6b7280;font-weight:800;}
.m-bottom{position:fixed;left:0;right:0;bottom:0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(245,246,248,.86);backdrop-filter:blur(12px);border-top:1px solid #e8eaee;}
.m-bottomInner{max-width:1040px;margin:0 auto;display:grid;gap:10px;}
.m-bottomRow{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;}
.m-rowBetween{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
.m-rowEnd{display:flex;justify-content:flex-end;margin-top:10px;}
.m-check{display:flex;gap:10px;align-items:center;font-weight:900;color:#111827;}
.m-check input{width:18px;height:18px;}
.m-addGrid{display:grid;grid-template-columns:1fr 220px;gap:10px;margin-top:10px;}
.m-form{display:grid;gap:10px;margin-top:10px;}
.m-ok{font-size:13px;color:#166534;font-weight:800;}
.m-err{font-size:13px;color:#991b1b;font-weight:900;}
@media(max-width:860px){
  .m-title{font-size:30px;}
  .m-filter{grid-template-columns:1fr;gap:10px;}
  .m-grid3{grid-template-columns:1fr;gap:12px;}
  .m-grid2{grid-template-columns:1fr;gap:12px;}
  .m-empBtns{grid-template-columns:1fr;gap:10px;}
  .m-addGrid{grid-template-columns:1fr;gap:10px;}
}
`;

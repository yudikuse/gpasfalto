// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type ViewTab = "AMBOS" | "ALMOCO" | "JANTA";

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

function isTodayISO(iso: string) {
  return iso === isoLocalToday();
}

function defaultViewTabForNow(dateISO: string): ViewTab {
  // seu pedido: por padrão abre ALMOÇO até 11h, depois abre JANTA.
  if (!isTodayISO(dateISO)) return "AMBOS";
  const h = new Date().getHours();
  return h < 11 ? "ALMOCO" : "JANTA";
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

function shiftLabel(s: Shift) {
  return s === "ALMOCO" ? "Almoço" : "Janta";
}

function deepSamePicks(a: Record<string, Pick>, b: Record<string, Pick>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const pa = a[k] ?? { ALMOCO: false, JANTA: false };
    const pb = b[k] ?? { ALMOCO: false, JANTA: false };
    if (pa.ALMOCO !== pb.ALMOCO || pa.JANTA !== pb.JANTA) return false;
  }
  return true;
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

  // picks = marcações atuais (antes de salvar)
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // savedPicks = retrato do que está salvo no banco (para "Restaurar salvo")
  const [savedPicks, setSavedPicks] = useState<Record<string, Pick>>({});

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [search, setSearch] = useState<string>("");
  const [showOnlyMarked, setShowOnlyMarked] = useState<boolean>(false);

  const [viewTab, setViewTab] = useState<ViewTab>(() => defaultViewTabForNow(isoLocalToday()));
  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);

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

  // quando muda data, recalcula aba padrão (almoço até 11h)
  useEffect(() => {
    setViewTab(defaultViewTabForNow(dateISO));
  }, [dateISO]);

  // carrega obras + funcionários
  useEffect(() => {
    if (!sessionUserId) return;

    (async () => {
      setBusy("Carregando...");
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
      setSavedPicks(map);

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  // carrega contrato + favoritos + pedidos do dia (almoço/janta) + linhas (salvo)
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

      // ✅ nomes corretos do schema: cutoff_lunch / cutoff_dinner
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
        setSavedPicks(empty);

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
          .select("id,restaurant_id,status,shift,closed_at")
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

      const saved: Record<string, Pick> = {};
      for (const e of employees) saved[e.id] = { ALMOCO: false, JANTA: false };

      async function applyLines(order: Order | null, shift: Shift) {
        if (!order?.id) return;
        const lRes = await supabase
          .from("meal_order_lines")
          .select("employee_id")
          .eq("meal_order_id", order.id);

        if (lRes.error) throw new Error(lRes.error.message);
        const rows = (lRes.data ?? []) as any[];
        for (const r of rows) {
          const empId = r.employee_id as string;
          if (!saved[empId]) saved[empId] = { ALMOCO: false, JANTA: false };
          saved[empId][shift] = true;
        }
      }

      try {
        await Promise.all([applyLines(lunch.order, "ALMOCO"), applyLines(dinner.order, "JANTA")]);
      } catch (e: any) {
        setBusy(null);
        setToast(`Erro itens: ${e?.message ?? "falha ao carregar itens"}`);
        return;
      }

      // ao carregar, "o que está salvo" vira a base da tela
      setSavedPicks(saved);
      setPicks(saved);

      setBusy(null);
    })();
  }, [sessionUserId, selectedWorksiteId, dateISO, employees]);

  const employeesOrdered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = employees.filter((e) => (q ? e.full_name.toLowerCase().includes(q) : true));

    if (showOnlyMarked) {
      filtered = filtered.filter((e) => {
        const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
        if (viewTab === "ALMOCO") return !!p.ALMOCO;
        if (viewTab === "JANTA") return !!p.JANTA;
        return !!p.ALMOCO || !!p.JANTA;
      });
    }

    const fav: Employee[] = [];
    const normal: Employee[] = [];
    const third: Employee[] = [];

    for (const e of filtered) {
      if (favoritesIds.has(e.id)) fav.push(e);
      else if (e.is_third_party) third.push(e);
      else normal.push(e);
    }

    return [...fav, ...normal, ...third];
  }, [employees, favoritesIds, search, showOnlyMarked, picks, viewTab]);

  const nowCounts = useMemo(() => {
    let almoco = 0;
    let janta = 0;
    for (const empId of Object.keys(picks)) {
      if (picks[empId]?.ALMOCO) almoco++;
      if (picks[empId]?.JANTA) janta++;
    }
    return { almoco, janta };
  }, [picks]);

  const savedCounts = useMemo(() => {
    let almoco = 0;
    let janta = 0;
    for (const empId of Object.keys(savedPicks)) {
      if (savedPicks[empId]?.ALMOCO) almoco++;
      if (savedPicks[empId]?.JANTA) janta++;
    }
    return { almoco, janta };
  }, [savedPicks]);

  const isSavedLunch = !!orderLunch?.id;
  const isSavedDinner = !!orderDinner?.id;

  const canRestore = useMemo(() => !deepSamePicks(picks, savedPicks), [picks, savedPicks]);

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
      return { ...prev, [empId]: { ...cur, [shift]: !cur[shift] } };
    });
  }

  function setAll(shift: Shift, value: boolean) {
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
      const next = { ...prev };
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
        .select("employee_id")
        .eq("meal_order_id", orderId);

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
      setToast("Copiado do dia anterior (apenas na tela). Agora salve o turno.");
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro copiar: ${e?.message ?? "falha"}`);
    }
  }

  async function ensureOrder(shift: Shift): Promise<Order | null> {
    if (!selectedWorksiteId || !contract) return null;

    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;

    if (existing?.id) {
      // bloqueia se já fechou
      if (existing.closed_at) throw new Error("Pedido já fechado. Não é possível alterar.");
      const upd = await supabase
        .from("meal_orders")
        .update({ restaurant_id: contract.restaurant_id })
        .eq("id", existing.id);

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

    const late =
      shift === "ALMOCO"
        ? nowAfterCutoff(contract.cutoff_lunch)
        : nowAfterCutoff(contract.cutoff_dinner);

    if (late && contract.allow_after_cutoff === false) {
      setToast("Atenção: passou do horário e esse contrato não permite após cutoff.");
      return;
    }

    setBusy(`Salvando ${shiftLabel(shift)}...`);
    setToast(null);

    try {
      const order = await ensureOrder(shift);
      if (!order?.id) {
        setBusy(null);
        setToast("Não foi possível criar/obter o pedido.");
        return;
      }

      // substitui as linhas do turno
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

      // o que está na tela vira "salvo"
      setSavedPicks((prev) => {
        const next = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
          const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
          next[e.id] = shift === "ALMOCO" ? { ...cur, ALMOCO: !!p.ALMOCO } : { ...cur, JANTA: !!p.JANTA };
        }
        return next;
      });

      setBusy(null);
      setToast(`${shiftLabel(shift)} salvo ✅`);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro salvar: ${e?.message ?? "falha"}`);
    }
  }

  async function cancelShift(shift: Shift) {
    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (!existing?.id) {
      setToast(`Não há ${shiftLabel(shift)} salvo para cancelar.`);
      return;
    }
    if (existing.closed_at) {
      setToast("Pedido já fechado. Não é possível cancelar.");
      return;
    }

    setBusy(`Cancelando ${shiftLabel(shift)}...`);
    setToast(null);

    try {
      // ✅ CANCELAR robusto (sem mexer em enum): apaga linhas + apaga pedido
      const delLines = await supabase.from("meal_order_lines").delete().eq("meal_order_id", existing.id);
      if (delLines.error) throw new Error(delLines.error.message);

      const delOrder = await supabase.from("meal_orders").delete().eq("id", existing.id);
      if (delOrder.error) throw new Error(delOrder.error.message);

      // zera marcações do turno na tela
      setPicks((prev) => {
        const next = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
          next[e.id] = shift === "ALMOCO" ? { ...cur, ALMOCO: false } : { ...cur, JANTA: false };
        }
        return next;
      });

      // zera "salvo" do turno
      setSavedPicks((prev) => {
        const next = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { ALMOCO: false, JANTA: false };
          next[e.id] = shift === "ALMOCO" ? { ...cur, ALMOCO: false } : { ...cur, JANTA: false };
        }
        return next;
      });

      if (shift === "ALMOCO") setOrderLunch(null);
      else setOrderDinner(null);

      setBusy(null);
      setToast(`${shiftLabel(shift)} cancelado ✅`);
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro cancelar: ${e?.message ?? "falha"}`);
    }
  }

  function buildSummary() {
    const ws = worksites.find((w) => w.id === selectedWorksiteId);
    const wsName = ws ? `${ws.name}${ws.city ? ` - ${ws.city}` : ""}` : selectedWorksiteId;

    const selectedLunch = employees
      .filter((e) => (picks[e.id]?.ALMOCO ? true : false))
      .map((e) => `- ${e.full_name}${e.is_third_party ? " (terceiro)" : ""}`);

    const selectedDinner = employees
      .filter((e) => (picks[e.id]?.JANTA ? true : false))
      .map((e) => `- ${e.full_name}${e.is_third_party ? " (terceiro)" : ""}`);

    const cutoff = contract
      ? `Horário limite: Almoço ${contract.cutoff_lunch ?? "--"} | Janta ${contract.cutoff_dinner ?? "--"}`
      : "";

    return (
      `Refeições • ${wsName} • ${dateISO}\n` +
      (cutoff ? `${cutoff}\n\n` : "\n") +
      `ALMOÇO (${selectedLunch.length}):\n` +
      (selectedLunch.length ? selectedLunch.join("\n") : "- (ninguém marcado)") +
      "\n\n" +
      `JANTA (${selectedDinner.length}):\n` +
      (selectedDinner.length ? selectedDinner.join("\n") : "- (ninguém marcado)")
    );
  }

  async function copySummary() {
    const text = buildSummary();
    const ok = await copyToClipboard(text);
    setCopiedBanner(ok ? "Resumo copiado ✅ (cole no WhatsApp)" : "Falha ao copiar 😕");
    setTimeout(() => setCopiedBanner(null), 2400);
  }

  async function addEmployee() {
    const name = newName.trim();
    if (!name) {
      setToast("Informe o nome.");
      return;
    }

    setBusy("Adicionando...");
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
    setSavedPicks((prev) => ({
      ...prev,
      [created.id]: { ALMOCO: false, JANTA: false },
    }));

    setNewName("");
    setNewIsThird(false);
    setShowAdd(false);
    setToast("Pessoa adicionada ✅");
  }

  const ws = worksites.find((w) => w.id === selectedWorksiteId);
  const wsText = ws ? `${ws.name}${ws.city ? ` - ${ws.city}` : ""}` : "";

  const bottomShift: Shift =
    viewTab === "JANTA" ? "JANTA" : "ALMOCO"; // quando AMBOS, deixa a barra focar no ALMOÇO (você troca pela aba)

  const bottomSaveText = bottomShift === "ALMOCO" ? "Salvar Almoço" : "Salvar Janta";
  const bottomCancelText = bottomShift === "ALMOCO" ? "Cancelar Almoço" : "Cancelar Janta";

  const showLunch = viewTab === "AMBOS" || viewTab === "ALMOCO";
  const showDinner = viewTab === "AMBOS" || viewTab === "JANTA";

  if (!sessionUserId) {
    return (
      <div className="page-root">
        <div className="page-container">
          <div className="card">
            <div className="top">
              <img className="logo" src="/gpasfalto-logo.png" alt="GP Asfalto" />
              <div className="title">Refeições</div>
              <div className="subtitle">Login simples por e-mail (link mágico)</div>
            </div>

            <div className="form">
              <label className="label">E-mail</label>
              <input
                className="input"
                placeholder="seuemail@empresa.com"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                inputMode="email"
                autoComplete="email"
              />

              <button className="btn btn-primary" onClick={sendMagicLink} disabled={!loginEmail.trim() || !!busy}>
                {busy ? busy : "Enviar link de acesso"}
              </button>

              {loginSent && <div className="hint ok">Link enviado. Abra seu e-mail e clique para entrar.</div>}
              {toast && <div className="hint err">{toast}</div>}
            </div>
          </div>
        </div>

        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="page-root">
      <div className="page-container">
        <div className="header">
          <div className="header-left">
            <img className="logo" src="/gpasfalto-logo.png" alt="GP Asfalto" />
            <div>
              <div className="title">Refeições</div>
              <div className="subtitle">Logado: {userEmail || sessionUserId}</div>
            </div>
          </div>

          <div className="header-right">
            <div className="pill">Data: <b>{dateISO}</b></div>
            <button className="btn btn-ghost" onClick={logout}>Sair</button>
          </div>
        </div>

        <div className="filters card">
          <div className="field">
            <div className="label">Obra</div>
            <select className="input" value={selectedWorksiteId} onChange={(e) => setSelectedWorksiteId(e.target.value)}>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.city ? `- ${w.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <div className="label">Data</div>
            <input className="input" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>

          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <div className="label">Buscar</div>
            <input
              className="input"
              placeholder="Nome do funcionário..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="summary">
          <div className="card">
            <div className="kicker">Totais do dia</div>
            <div className="big">
              {savedCounts.almoco} / {savedCounts.janta}
            </div>
            <div className="muted">Já pedido (salvo) • Almoço / Janta</div>
            <div className="chips">
              <span className={`chip ${isSavedLunch ? "chip-ok" : "chip-off"}`}>
                Almoço: {isSavedLunch ? "salvo" : "não salvo"}
              </span>
              <span className={`chip ${isSavedDinner ? "chip-ok" : "chip-off"}`}>
                Janta: {isSavedDinner ? "salvo" : "não salvo"}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="kicker">Horário limite</div>
            <div className="big small">
              {contract ? `${contract.cutoff_lunch ?? "--"} / ${contract.cutoff_dinner ?? "--"}` : "-- / --"}
            </div>
            <div className="muted">Almoço / Janta</div>
            <div className="muted" style={{ marginTop: 6 }}>
              {contract?.allow_after_cutoff === false ? "Contrato NÃO permite após o limite." : "Contrato permite após o limite."}
            </div>
          </div>

          <div className="card">
            <div className="kicker">Ações rápidas</div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={copyYesterday} disabled={!!busy}>Copiar ontem</button>
              <button className="btn btn-ghost" onClick={copySummary} disabled={!!busy}>Copiar resumo</button>
              <button className="btn btn-ghost" onClick={() => setShowAdd((v) => !v)} disabled={!!busy}>
                {showAdd ? "Fechar" : "Adicionar pessoa"}
              </button>
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {wsText} • {dateISO}
            </div>
          </div>
        </div>

        {toast && <div className={`banner ${toast.toLowerCase().includes("erro") ? "banner-err" : "banner-ok"}`}>{toast}</div>}
        {copiedBanner && <div className="banner banner-ok">{copiedBanner}</div>}

        <div className="nowTotals">
          <div className="card card-tint-green">
            <div className="kicker">Almoço (marcados agora)</div>
            <div className="big">{nowCounts.almoco}</div>
          </div>
          <div className="card card-tint-blue">
            <div className="kicker">Janta (marcados agora)</div>
            <div className="big">{nowCounts.janta}</div>
          </div>
        </div>

        <div className="card">
          <div className="markHeader">
            <div>
              <div className="kicker">Marcação</div>
              <div className="muted">
                Visual app-like: por padrão abre <b>{defaultViewTabForNow(dateISO) === "ALMOCO" ? "ALMOÇO" : "JANTA"}</b>{" "}
                (almoço até 11h).
              </div>
            </div>

            <label className="onlyMarked">
              <input type="checkbox" checked={showOnlyMarked} onChange={(e) => setShowOnlyMarked(e.target.checked)} />
              <span>Mostrar só marcados</span>
            </label>
          </div>

          <div className="tabs">
            <button className={`tab ${viewTab === "AMBOS" ? "tab-on" : ""}`} onClick={() => setViewTab("AMBOS")}>
              Ambos
            </button>
            <button className={`tab ${viewTab === "ALMOCO" ? "tab-on" : ""}`} onClick={() => setViewTab("ALMOCO")}>
              Almoço
            </button>
            <button className={`tab ${viewTab === "JANTA" ? "tab-on" : ""}`} onClick={() => setViewTab("JANTA")}>
              Janta
            </button>
          </div>

          <div className="miniActions">
            {showLunch && (
              <button className="btn btn-ghost" onClick={() => setAll("ALMOCO", true)} disabled={!!busy}>
                Todos almoço
              </button>
            )}
            {showDinner && (
              <button className="btn btn-ghost" onClick={() => setAll("JANTA", true)} disabled={!!busy}>
                Todos janta
              </button>
            )}

            <button
              className="btn btn-danger"
              onClick={() => {
                if (viewTab === "ALMOCO") clearShift("ALMOCO");
                else if (viewTab === "JANTA") clearShift("JANTA");
                else clearAll();
              }}
              disabled={!!busy}
            >
              Limpar
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="card">
            <div className="kicker">Adicionar pessoa</div>

            <div className="addGrid">
              <div className="field">
                <div className="label">Nome completo</div>
                <input
                  className="input"
                  placeholder="Ex.: João da Silva"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <label className="checkRow">
                <input type="checkbox" checked={newIsThird} onChange={(e) => setNewIsThird(e.target.checked)} />
                <span>É terceiro</span>
              </label>

              <button className="btn btn-primary" onClick={addEmployee} disabled={!!busy}>
                {busy ? busy : "Adicionar"}
              </button>
            </div>
          </div>
        )}

        <div className="list">
          {employeesOrdered.map((e) => {
            const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
            const isFav = favoritesIds.has(e.id);

            const activeTint =
              viewTab === "ALMOCO"
                ? p.ALMOCO
                : viewTab === "JANTA"
                ? p.JANTA
                : p.ALMOCO || p.JANTA;

            return (
              <div key={e.id} className={`emp card empCard ${activeTint ? "empOn" : ""}`}>
                <div className="empTop">
                  <div className="empName">{e.full_name}</div>
                  <div className="empBadges">
                    {isFav && <span className="badge badge-fav">favorito</span>}
                    {e.is_third_party && <span className="badge badge-third">terceiro</span>}
                  </div>
                </div>

                <div className="empBtns">
                  {showLunch && (
                    <button
                      className={`pickBtn ${p.ALMOCO ? "pickOn lunch" : "pickOff lunch"}`}
                      onClick={() => togglePick(e.id, "ALMOCO")}
                      disabled={!!busy}
                    >
                      {p.ALMOCO ? "✓ Almoço" : "+ Almoço"}
                    </button>
                  )}

                  {showDinner && (
                    <button
                      className={`pickBtn ${p.JANTA ? "pickOn dinner" : "pickOff dinner"}`}
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

          {employeesOrdered.length === 0 && (
            <div className="card muted" style={{ textAlign: "center", padding: 18 }}>
              Nenhum funcionário encontrado.
            </div>
          )}
        </div>

        {/* Barra fixa (botões largos) */}
        <div className="bottomBar">
          <div className="bottomInner">
            <button className="btn btn-ghost wide" onClick={() => setPicks(savedPicks)} disabled={!canRestore || !!busy}>
              Restaurar salvo
            </button>

            <button
              className={`btn wide ${bottomShift === "ALMOCO" ? "btn-green" : "btn-blue"}`}
              onClick={() => saveShift(bottomShift)}
              disabled={!!busy || !selectedWorksiteId}
            >
              {busy?.toLowerCase().includes("salvando") ? busy : bottomSaveText}
            </button>

            <button
              className="btn btn-danger wide"
              onClick={() => cancelShift(bottomShift)}
              disabled={!!busy || (bottomShift === "ALMOCO" ? !orderLunch?.id : !orderDinner?.id)}
            >
              {bottomCancelText}
            </button>

            <button className="btn btn-ghost wide" onClick={copySummary} disabled={!!busy}>
              Copiar resumo
            </button>
          </div>
        </div>
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  :global(body){
    background:#f3f4f6;
  }
  .page-root{
    min-height:100vh;
    padding:18px 12px 130px;
  }
  .page-container{
    max-width:980px;
    margin:0 auto;
  }

  .header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:14px;
    padding:6px 2px 14px;
  }
  .header-left{
    display:flex;
    align-items:center;
    gap:12px;
  }
  .header-right{
    display:flex;
    align-items:center;
    gap:10px;
  }
  .logo{
    height:28px;
    width:auto;
    display:block;
  }
  .title{
    font-size:26px;
    line-height:1.1;
    font-weight:700;
    letter-spacing:-0.02em;
    color:#0f172a;
  }
  .subtitle{
    font-size:13px;
    color:#64748b;
    margin-top:2px;
  }
  .pill{
    border:1px solid #e5e7eb;
    background:#fff;
    padding:8px 12px;
    border-radius:999px;
    font-size:12px;
    color:#334155;
    box-shadow:0 6px 20px rgba(15,23,42,0.06);
  }

  .card{
    background:#fff;
    border:1px solid #e5e7eb;
    border-radius:18px;
    box-shadow:0 10px 28px rgba(15,23,42,0.06);
    padding:14px;
  }

  .filters{
    display:grid;
    grid-template-columns: 1.4fr 0.8fr 1fr;
    gap:12px;
    margin-bottom:14px;
  }
  .field{ display:flex; flex-direction:column; gap:6px; }
  .label{
    font-size:11px;
    font-weight:700;
    letter-spacing:0.08em;
    text-transform:uppercase;
    color:#94a3b8;
  }
  .input{
    width:100%;
    border-radius:14px;
    border:1px solid #e5e7eb;
    padding:10px 12px;
    background:#fff;
    outline:none;
    font-size:14px;
    color:#0f172a;
  }
  .input:focus{
    border-color: rgba(255,75,43,0.35);
    box-shadow:0 0 0 3px rgba(255,75,43,0.12);
  }

  .summary{
    display:grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap:12px;
    margin-bottom:12px;
  }
  .kicker{
    font-size:11px;
    font-weight:800;
    letter-spacing:0.12em;
    text-transform:uppercase;
    color:#94a3b8;
  }
  .big{
    font-size:34px;
    font-weight:800;
    letter-spacing:-0.02em;
    color:#0f172a;
    margin-top:6px;
  }
  .big.small{
    font-size:22px;
    font-weight:800;
  }
  .muted{
    font-size:12px;
    color:#64748b;
    margin-top:6px;
  }
  .chips{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    margin-top:10px;
  }
  .chip{
    font-size:12px;
    padding:6px 10px;
    border-radius:999px;
    border:1px solid #e5e7eb;
    background:#fff;
    color:#334155;
    font-weight:700;
  }
  .chip-ok{
    border-color:#86efac;
    background:#ecfdf5;
    color:#065f46;
  }
  .chip-off{
    border-color:#e5e7eb;
    background:#f8fafc;
    color:#475569;
  }

  .actions{
    display:flex;
    flex-wrap:wrap;
    gap:8px;
    margin-top:10px;
  }

  .banner{
    border-radius:14px;
    padding:10px 12px;
    font-size:13px;
    font-weight:700;
    margin:12px 0;
    border:1px solid;
  }
  .banner-ok{
    background:#ecfdf5;
    border-color:#86efac;
    color:#065f46;
  }
  .banner-err{
    background:#fef2f2;
    border-color:#fecaca;
    color:#991b1b;
  }

  .nowTotals{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:12px;
    margin-bottom:12px;
  }
  .card-tint-green{
    border-color:#a7f3d0;
    background:linear-gradient(180deg, #ecfdf5 0%, #ffffff 60%);
  }
  .card-tint-blue{
    border-color:#bfdbfe;
    background:linear-gradient(180deg, #eff6ff 0%, #ffffff 60%);
  }

  .markHeader{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:12px;
    flex-wrap:wrap;
  }
  .onlyMarked{
    display:flex;
    align-items:center;
    gap:10px;
    user-select:none;
    padding:8px 10px;
    border:1px solid #e5e7eb;
    border-radius:999px;
    background:#fff;
    font-size:13px;
    color:#0f172a;
    font-weight:700;
  }

  .tabs{
    display:flex;
    gap:10px;
    justify-content:center;
    margin-top:14px;
    flex-wrap:wrap;
  }
  .tab{
    border:1px solid #e5e7eb;
    background:#fff;
    border-radius:999px;
    padding:10px 16px;
    font-size:14px;
    font-weight:800;
    cursor:pointer;
    color:#334155;
  }
  .tab-on{
    border-color:#bfdbfe;
    background:#eff6ff;
    color:#1d4ed8;
  }

  .miniActions{
    display:flex;
    gap:10px;
    justify-content:center;
    flex-wrap:wrap;
    margin-top:12px;
  }

  .list{
    margin-top:12px;
    display:grid;
    gap:12px;
  }
  .empCard{ padding:12px 12px; }
  .empOn{
    border-color:#cbd5e1;
    box-shadow:0 12px 34px rgba(15,23,42,0.08);
  }
  .empTop{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:10px;
    margin-bottom:10px;
  }
  .empName{
    font-size:14px;
    font-weight:800;
    color:#0f172a;
  }
  .empBadges{
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    justify-content:flex-end;
  }
  .badge{
    font-size:11px;
    padding:5px 10px;
    border-radius:999px;
    font-weight:900;
    border:1px solid;
    white-space:nowrap;
  }
  .badge-fav{
    background:#fff7ed;
    border-color:#fed7aa;
    color:#9a3412;
  }
  .badge-third{
    background:#eff6ff;
    border-color:#bfdbfe;
    color:#1d4ed8;
  }

  .empBtns{
    display:grid;
    gap:10px;
    grid-template-columns: 1fr;
  }
  .pickBtn{
    width:100%;
    border-radius:16px;
    padding:14px 14px;
    font-size:16px;
    font-weight:900;
    border:1px solid #e5e7eb;
    background:#fff;
    cursor:pointer;
  }
  .pickOff.lunch{
    background:#f0fdf4;
    border-color:#a7f3d0;
    color:#065f46;
  }
  .pickOn.lunch{
    background:#bbf7d0;
    border-color:#34d399;
    color:#065f46;
  }
  .pickOff.dinner{
    background:#eff6ff;
    border-color:#bfdbfe;
    color:#1d4ed8;
  }
  .pickOn.dinner{
    background:#dbeafe;
    border-color:#60a5fa;
    color:#1d4ed8;
  }

  .btn{
    border-radius:14px;
    padding:10px 12px;
    border:1px solid #e5e7eb;
    background:#fff;
    cursor:pointer;
    font-weight:800;
    font-size:13px;
  }
  .btn:disabled{
    opacity:0.55;
    cursor:not-allowed;
  }
  .btn-ghost{
    background:#fff;
    color:#0f172a;
  }
  .btn-danger{
    border-color:rgba(239,68,68,0.25);
    background:rgba(239,68,68,0.08);
    color:#991b1b;
  }
  .btn-primary{
    border-color: rgba(255,75,43,0.28);
    background: linear-gradient(90deg, rgba(255,75,43,0.95), rgba(255,122,89,0.95));
    color:#fff;
  }
  .btn-green{
    border-color:rgba(16,185,129,0.25);
    background: linear-gradient(90deg, rgba(16,185,129,0.95), rgba(34,197,94,0.95));
    color:#fff;
  }
  .btn-blue{
    border-color:rgba(59,130,246,0.25);
    background: linear-gradient(90deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95));
    color:#fff;
  }
  .wide{
    width:100%;
    padding:14px 14px;
    font-size:16px;
    border-radius:18px;
  }

  .bottomBar{
    position:fixed;
    left:0;
    right:0;
    bottom:0;
    background:rgba(243,244,246,0.86);
    backdrop-filter: blur(10px);
    border-top:1px solid #e5e7eb;
    padding:10px 12px;
    z-index:50;
  }
  .bottomInner{
    max-width:980px;
    margin:0 auto;
    display:grid;
    grid-template-columns: 1fr;
    gap:10px;
  }

  .top{
    text-align:center;
    padding:6px 0 6px;
  }
  .form{
    margin-top:10px;
    display:grid;
    gap:10px;
  }
  .hint{
    font-size:13px;
    font-weight:700;
    margin-top:2px;
  }
  .hint.ok{ color:#065f46; }
  .hint.err{ color:#991b1b; }

  .addGrid{
    display:grid;
    gap:10px;
    margin-top:10px;
  }
  .checkRow{
    display:flex;
    align-items:center;
    gap:10px;
    font-size:14px;
    font-weight:800;
    color:#0f172a;
    padding:10px 12px;
    border:1px solid #e5e7eb;
    border-radius:14px;
    background:#fff;
  }

  @media (max-width: 820px){
    .summary{ grid-template-columns:1fr; }
    .filters{ grid-template-columns: 1fr; }
    .nowTotals{ grid-template-columns:1fr; }
    .title{ font-size:24px; }
  }
`;

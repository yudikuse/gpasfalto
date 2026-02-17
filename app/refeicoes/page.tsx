// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");

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
          .select("id,restaurant_id,status,shift")
          .eq("worksite_id", selectedWorksiteId)
          .eq("meal_date", dateISO) // <-- aqui
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

      const map: Record<string, Pick> = {};
      for (const e of employees) map[e.id] = { ALMOCO: false, JANTA: false };

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
          if (!map[empId]) map[empId] = { ALMOCO: false, JANTA: false };
          map[empId][shift] = true;
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

  const totals = useMemo(() => {
    let almoco = 0;
    let janta = 0;
    for (const empId of Object.keys(picks)) {
      if (picks[empId]?.ALMOCO) almoco++;
      if (picks[empId]?.JANTA) janta++;
    }
    return { almoco, janta };
  }, [picks]);

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
        .eq("meal_date", y) // <-- aqui
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
      setToast("Copiado do dia anterior.");
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro copiar: ${e?.message ?? "falha"}`);
    }
  }

  async function ensureOrder(shift: Shift): Promise<Order | null> {
    if (!selectedWorksiteId || !contract) return null;

    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (existing?.id) {
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
        meal_date: dateISO, // <-- aqui (ERA order_date)
        shift,
        status: "DRAFT",
      })
      .select("id,restaurant_id,status,shift")
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

      setBusy(null);
      setToast(shift === "ALMOCO" ? "Almoço salvo ✅" : "Janta salva ✅");
    } catch (e: any) {
      setBusy(null);
      setToast(`Erro salvar: ${e?.message ?? "falha"}`);
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

  const inputStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    padding: "10px 12px",
    background: "#fff",
    outline: "none",
  };

  const btnBase: React.CSSProperties = {
    borderRadius: 999,
    border: "1px solid #e5e7eb",
    padding: "8px 12px",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  };

  const btnPrimary: React.CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(255,75,43,0.25)",
    background: "rgba(255,75,43,0.95)",
    color: "#fff",
  };

  const btnDanger: React.CSSProperties = {
    ...btnBase,
    border: "1px solid rgba(255,75,43,0.35)",
    background: "rgba(255,75,43,0.12)",
    color: "#7c2d12",
  };

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
                style={{ ...btnPrimary, padding: "10px 12px", borderRadius: 14 }}
                onClick={sendMagicLink}
                disabled={!loginEmail.trim() || !!busy}
              >
                {busy ? busy : "Enviar link de acesso"}
              </button>

              {loginSent && (
                <div style={{ fontSize: 13, color: "#166534" }}>
                  Link enviado. Abra seu e-mail e clique para entrar.
                </div>
              )}

              {toast && <div style={{ fontSize: 13, color: "#991b1b" }}>{toast}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root">
      <div className="page-container">
        <div className="page-header">
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
              <button style={btnBase} onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <div style={{ minWidth: 280 }}>
            <div className="filter-label">Obra</div>
            <select
              style={inputStyle}
              value={selectedWorksiteId}
              onChange={(e) => setSelectedWorksiteId(e.target.value)}
            >
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.city ? `- ${w.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 180 }}>
            <div className="filter-label">Data</div>
            <input
              type="date"
              style={inputStyle}
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
            />
          </div>

          <div style={{ minWidth: 240, flex: 1 }}>
            <div className="filter-label">Buscar</div>
            <input
              style={inputStyle}
              placeholder="Nome do funcionário..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">Totais</div>
            <div className="summary-value">
              {totals.almoco} / {totals.janta}
            </div>
            <div className="summary-subvalue">Almoço / Janta</div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Horário limite</div>
            <div className="summary-value" style={{ fontSize: "1.2rem" }}>
              {contract ? `${contract.cutoff_lunch ?? "--"} / ${contract.cutoff_dinner ?? "--"}` : "-- / --"}
            </div>
            <div className="summary-subvalue">Almoço / Janta</div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Ações rápidas</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button style={btnBase} onClick={copyYesterday} disabled={!!busy}>
                Copiar ontem
              </button>
              <button style={btnBase} onClick={() => copySummary("ALMOCO")} disabled={!!busy}>
                Resumo Almoço
              </button>
              <button style={btnBase} onClick={() => copySummary("JANTA")} disabled={!!busy}>
                Resumo Janta
              </button>
              <button style={btnBase} onClick={() => setShowAdd((v) => !v)} disabled={!!busy}>
                {showAdd ? "Fechar" : "Adicionar pessoa"}
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              {worksites.find((w) => w.id === selectedWorksiteId)?.name ?? ""} • {dateISO}
            </div>
          </div>
        </div>

        {copiedBanner && (
          <div className="state-card" style={{ borderStyle: "dashed" }}>
            {copiedBanner}
          </div>
        )}

        {showAdd && (
          <div className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Adicionar pessoa</div>
                <div className="section-subtitle">Funcionário fixo ou terceiro.</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 12 }}>
              <div>
                <div className="filter-label">Nome completo</div>
                <input
                  style={inputStyle}
                  placeholder="Ex.: João da Silva"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div>
                <div className="filter-label">Tipo</div>
                <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={newIsThird}
                    onChange={(e) => setNewIsThird(e.target.checked)}
                  />
                  <span style={{ fontSize: 13 }}>É terceiro</span>
                </label>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button style={btnBase} onClick={() => setShowAdd(false)} disabled={!!busy}>
                Cancelar
              </button>
              <button style={btnPrimary} onClick={addEmployee} disabled={!!busy}>
                {busy ? busy : "Adicionar"}
              </button>
            </div>

            {toast && <div style={{ marginTop: 10, fontSize: 13 }}>{toast}</div>}
          </div>
        )}

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">Você salva almoço e janta em momentos diferentes.</div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button style={btnBase} onClick={() => setAll("ALMOCO", true)} disabled={!!busy}>
                Todos almoço
              </button>
              <button style={btnBase} onClick={() => setAll("JANTA", true)} disabled={!!busy}>
                Todos janta
              </button>
              <button style={btnDanger} onClick={clearAll} disabled={!!busy}>
                Limpar
              </button>
              <button style={btnPrimary} onClick={() => saveShift("ALMOCO")} disabled={!!busy || !selectedWorksiteId}>
                {busy?.includes("almoço") ? busy : "Salvar Almoço"}
              </button>
              <button style={btnPrimary} onClick={() => saveShift("JANTA")} disabled={!!busy || !selectedWorksiteId}>
                {busy?.includes("janta") ? busy : "Salvar Janta"}
              </button>
            </div>
          </div>

          {toast && (
            <div className="state-card" style={{ marginBottom: 12 }}>
              {toast}
            </div>
          )}

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th style={{ width: 140, textAlign: "center" }}>Almoço</th>
                  <th style={{ width: 140, textAlign: "center" }}>Janta</th>
                </tr>
              </thead>
              <tbody>
                {employeesOrdered.map((e) => {
                  const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
                  const isFav = favoritesIds.has(e.id);

                  return (
                    <tr key={e.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ fontWeight: 600 }}>{e.full_name}</div>

                          {isFav && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "#ffe7cc",
                                border: "1px solid #fed7aa",
                                color: "#9a3412",
                                fontWeight: 700,
                              }}
                            >
                              favorito
                            </span>
                          )}

                          {e.is_third_party && (
                            <span
                              style={{
                                fontSize: 11,
                                padding: "4px 10px",
                                borderRadius: 999,
                                background: "#e0f2fe",
                                border: "1px solid #bae6fd",
                                color: "#075985",
                                fontWeight: 700,
                              }}
                            >
                              terceiro
                            </span>
                          )}
                        </div>
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={p.ALMOCO}
                            onChange={(ev) =>
                              setPicks((prev) => ({
                                ...prev,
                                [e.id]: {
                                  ...(prev[e.id] ?? { ALMOCO: false, JANTA: false }),
                                  ALMOCO: ev.target.checked,
                                },
                              }))
                            }
                          />
                          <span style={{ fontSize: 12, color: "#6b7280" }}>Sim</span>
                        </label>
                      </td>

                      <td style={{ textAlign: "center" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={p.JANTA}
                            onChange={(ev) =>
                              setPicks((prev) => ({
                                ...prev,
                                [e.id]: {
                                  ...(prev[e.id] ?? { ALMOCO: false, JANTA: false }),
                                  JANTA: ev.target.checked,
                                },
                              }))
                            }
                          />
                          <span style={{ fontSize: 12, color: "#6b7280" }}>Sim</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}

                {employeesOrdered.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 18, textAlign: "center", color: "#6b7280" }}>
                      Nenhum funcionário encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Observação: passou do horário?{" "}
            {contract?.allow_after_cutoff === false
              ? "Contrato não permite após o limite."
              : "Contrato permite após o limite."}
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
};

type Contract = {
  id: string;
  restaurant_id: string;
  cutoff_lunch: string | null; // "09:30:00"
  cutoff_dinner: string | null; // "15:30:00"
  allow_after_cutoff: boolean | null;
};

type Order = {
  id: string;
  restaurant_id: string;
  status: string | null;
};

type OrderLine = {
  employee_id: string;
  shift: "ALMOCO" | "JANTA";
  qty: number | null;
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
  // aceita "09:30" ou "09:30:00"
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
  const [order, setOrder] = useState<Order | null>(null);

  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState<string>("");

  // bootstrap auth
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

  // load base lists after login
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
          .select("id,full_name,active")
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

      // seleciona a primeira obra automaticamente
      if (!selectedWorksiteId && ws.length > 0) setSelectedWorksiteId(ws[0].id);

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  // whenever worksite/date changes, load favorites + contract + order + lines
  useEffect(() => {
    if (!sessionUserId) return;
    if (!selectedWorksiteId) return;

    (async () => {
      setBusy("Carregando pedido...");
      setToast(null);

      // favoritos da obra
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

      // contrato (pega o mais recente com start_date <= data)
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
        setOrder(null);
        setPicks({});
        setBusy(null);
        setToast("Sem contrato para essa obra/data.");
        return;
      }
      setContract({
        id: ct.id,
        restaurant_id: ct.restaurant_id,
        cutoff_lunch: ct.cutoff_lunch,
        cutoff_dinner: ct.cutoff_dinner,
        allow_after_cutoff: ct.allow_after_cutoff,
      });

      // pedido do dia (se existir)
      const oRes = await supabase
        .from("meal_orders")
        .select("id,restaurant_id,status")
        .eq("worksite_id", selectedWorksiteId)
        .eq("order_date", dateISO)
        .order("created_at", { ascending: false })
        .limit(1);

      if (oRes.error) {
        setBusy(null);
        setToast(`Erro pedido: ${oRes.error.message}`);
        return;
      }

      const o = (oRes.data?.[0] ?? null) as Order | null;
      setOrder(o);

      // carrega linhas
      if (o?.id) {
        const lRes = await supabase
          .from("meal_order_lines")
          .select("employee_id,shift,qty")
          .eq("meal_order_id", o.id);

        if (lRes.error) {
          setBusy(null);
          setToast(`Erro itens: ${lRes.error.message}`);
          return;
        }

        const lines = (lRes.data ?? []) as OrderLine[];
        const map: Record<string, Pick> = {};
        for (const e of employees) {
          map[e.id] = { ALMOCO: false, JANTA: false };
        }
        for (const ln of lines) {
          if (!map[ln.employee_id]) map[ln.employee_id] = { ALMOCO: false, JANTA: false };
          if (ln.shift === "ALMOCO") map[ln.employee_id].ALMOCO = (ln.qty ?? 0) > 0;
          if (ln.shift === "JANTA") map[ln.employee_id].JANTA = (ln.qty ?? 0) > 0;
        }
        setPicks(map);
      } else {
        // novo pedido (zera)
        const map: Record<string, Pick> = {};
        for (const e of employees) map[e.id] = { ALMOCO: false, JANTA: false };
        setPicks(map);
      }

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId, selectedWorksiteId, dateISO]);

  const employeesOrdered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = employees.filter((e) => (q ? e.full_name.toLowerCase().includes(q) : true));
    const fav: Employee[] = [];
    const rest: Employee[] = [];
    for (const e of list) {
      if (favoritesIds.has(e.id)) fav.push(e);
      else rest.push(e);
    }
    return [...fav, ...rest];
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
        emailRedirectTo: `${window.location.origin}/refeicoes`,
      },
    });

    setBusy(null);
    if (error) setToast(`Erro login: ${error.message}`);
    else setLoginSent(true);
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  function setAll(shift: "ALMOCO" | "JANTA", value: boolean) {
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

    const oRes = await supabase
      .from("meal_orders")
      .select("id")
      .eq("worksite_id", selectedWorksiteId)
      .eq("order_date", y)
      .order("created_at", { ascending: false })
      .limit(1);

    if (oRes.error) {
      setBusy(null);
      setToast(`Erro copiar: ${oRes.error.message}`);
      return;
    }

    const oid = oRes.data?.[0]?.id as string | undefined;
    if (!oid) {
      setBusy(null);
      setToast("Ontem não tem pedido nessa obra.");
      return;
    }

    const lRes = await supabase
      .from("meal_order_lines")
      .select("employee_id,shift,qty")
      .eq("meal_order_id", oid);

    if (lRes.error) {
      setBusy(null);
      setToast(`Erro copiar itens: ${lRes.error.message}`);
      return;
    }

    const lines = (lRes.data ?? []) as OrderLine[];
    const map: Record<string, Pick> = {};
    for (const e of employees) map[e.id] = { ALMOCO: false, JANTA: false };
    for (const ln of lines) {
      if (!map[ln.employee_id]) map[ln.employee_id] = { ALMOCO: false, JANTA: false };
      if (ln.shift === "ALMOCO") map[ln.employee_id].ALMOCO = (ln.qty ?? 0) > 0;
      if (ln.shift === "JANTA") map[ln.employee_id].JANTA = (ln.qty ?? 0) > 0;
    }
    setPicks(map);

    setBusy(null);
    setToast("Copiado do dia anterior.");
  }

  async function save() {
    if (!selectedWorksiteId) return;
    if (!contract) {
      setToast("Sem contrato para salvar.");
      return;
    }

    // regra simples de aviso (não bloqueia)
    const lateLunch = nowAfterCutoff(contract.cutoff_lunch);
    const lateDinner = nowAfterCutoff(contract.cutoff_dinner);
    if ((lateLunch || lateDinner) && contract.allow_after_cutoff === false) {
      setToast("Atenção: passou do horário e esse contrato não permite após cutoff.");
      // não bloqueia nesta 1ª versão
    }

    setBusy("Salvando...");
    setToast(null);

    // 1) cria/atualiza pedido do dia
    let orderId = order?.id ?? null;

    if (!orderId) {
      const ins = await supabase
        .from("meal_orders")
        .insert({
          worksite_id: selectedWorksiteId,
          restaurant_id: contract.restaurant_id,
          order_date: dateISO,
          status: "DRAFT",
        })
        .select("id,restaurant_id,status")
        .single();

      if (ins.error) {
        setBusy(null);
        setToast(`Erro criar pedido: ${ins.error.message}`);
        return;
      }
      orderId = ins.data.id;
      setOrder({ id: ins.data.id, restaurant_id: ins.data.restaurant_id, status: ins.data.status });
    } else {
      const upd = await supabase
        .from("meal_orders")
        .update({
          restaurant_id: contract.restaurant_id,
        })
        .eq("id", orderId);

      if (upd.error) {
        setBusy(null);
        setToast(`Erro atualizar pedido: ${upd.error.message}`);
        return;
      }
    }

    // 2) apaga linhas e recria (simples e seguro nesta fase)
    const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
    if (del.error) {
      setBusy(null);
      setToast(`Erro limpar itens: ${del.error.message}`);
      return;
    }

    const rows: any[] = [];
    for (const e of employees) {
      const p = picks[e.id];
      if (!p) continue;
      if (p.ALMOCO) rows.push({ meal_order_id: orderId, employee_id: e.id, shift: "ALMOCO", qty: 1 });
      if (p.JANTA) rows.push({ meal_order_id: orderId, employee_id: e.id, shift: "JANTA", qty: 1 });
    }

    if (rows.length > 0) {
      const insLines = await supabase.from("meal_order_lines").insert(rows);
      if (insLines.error) {
        setBusy(null);
        setToast(`Erro inserir itens: ${insLines.error.message}`);
        return;
      }
    }

    setBusy(null);
    setToast("Salvo ✅");
  }

  if (!sessionUserId) {
    return (
      <div className="min-h-screen bg-neutral-50 px-4 py-8">
        <div className="mx-auto max-w-md rounded-2xl bg-white p-5 shadow">
          <h1 className="text-xl font-semibold">Refeições</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Login simples por e-mail (link mágico).
          </p>

          <div className="mt-4 space-y-2">
            <label className="text-sm font-medium">E-mail</label>
            <input
              className="w-full rounded-xl border px-3 py-2 outline-none focus:ring"
              placeholder="seuemail@empresa.com"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              inputMode="email"
              autoComplete="email"
            />
            <button
              className="w-full rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              onClick={sendMagicLink}
              disabled={!loginEmail.trim() || !!busy}
            >
              {busy ? busy : "Enviar link de acesso"}
            </button>

            {loginSent && (
              <p className="text-sm text-green-700">
                Link enviado. Abra seu e-mail e clique para entrar.
              </p>
            )}

            {toast && <p className="text-sm text-red-700">{toast}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 px-3 py-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="rounded-2xl bg-white p-4 shadow">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">Refeições</h1>
              <p className="text-xs text-neutral-600">
                Logado: {userEmail || sessionUserId}
              </p>
            </div>
            <button
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={logout}
            >
              Sair
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div>
              <label className="text-sm font-medium">Obra</label>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2"
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

            <div>
              <label className="text-sm font-medium">Data</label>
              <input
                type="date"
                className="mt-1 w-full rounded-xl border px-3 py-2"
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
              />
            </div>

            <div className="rounded-xl border bg-neutral-50 p-3">
              <div className="text-xs text-neutral-600">Totais</div>
              <div className="mt-1 flex items-center gap-3 text-sm">
                <span><b>Almoço:</b> {totals.almoco}</span>
                <span><b>Janta:</b> {totals.janta}</span>
              </div>
              {contract && (
                <div className="mt-1 text-xs text-neutral-600">
                  Cutoff: Almoço {contract.cutoff_lunch ?? "--"} • Janta {contract.cutoff_dinner ?? "--"}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={copyYesterday}
              disabled={!!busy}
            >
              Copiar ontem
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={() => setAll("ALMOCO", true)}
              disabled={!!busy}
            >
              Todos almoço
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={() => setAll("JANTA", true)}
              disabled={!!busy}
            >
              Todos janta
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm"
              onClick={clearAll}
              disabled={!!busy}
            >
              Limpar
            </button>
            <button
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              onClick={save}
              disabled={!!busy || !selectedWorksiteId}
            >
              {busy ? busy : "Salvar"}
            </button>
          </div>

          {toast && (
            <div className="mt-3 rounded-xl border bg-white p-3 text-sm">
              {toast}
            </div>
          )}
        </div>

        <div className="rounded-2xl bg-white p-4 shadow">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Equipe</h2>
            <input
              className="w-44 rounded-xl border px-3 py-2 text-sm outline-none focus:ring"
              placeholder="Buscar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="mt-3 divide-y">
            {employeesOrdered.map((e) => {
              const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
              const isFav = favoritesIds.has(e.id);

              return (
                <div key={e.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {e.full_name}{" "}
                      {isFav && (
                        <span className="ml-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                          favorito
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.ALMOCO}
                        onChange={(ev) =>
                          setPicks((prev) => ({
                            ...prev,
                            [e.id]: { ...(prev[e.id] ?? { ALMOCO: false, JANTA: false }), ALMOCO: ev.target.checked },
                          }))
                        }
                      />
                      <span>Almoço</span>
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.JANTA}
                        onChange={(ev) =>
                          setPicks((prev) => ({
                            ...prev,
                            [e.id]: { ...(prev[e.id] ?? { ALMOCO: false, JANTA: false }), JANTA: ev.target.checked },
                          }))
                        }
                      />
                      <span>Janta</span>
                    </label>
                  </div>
                </div>
              );
            })}

            {employeesOrdered.length === 0 && (
              <div className="py-6 text-center text-sm text-neutral-600">
                Nenhum funcionário encontrado.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

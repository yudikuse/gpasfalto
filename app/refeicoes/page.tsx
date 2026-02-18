// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MealShift = "ALMOCO" | "JANTA";
type ViewMode = "AMBOS" | "ALMOCO" | "JANTA";

type Worksite = {
  id: string;
  name: string;
  active: boolean | null;
};

type Employee = {
  id: string;
  full_name: string;
  active: boolean | null;
  is_third_party: boolean | null;
  created_at: string | null;
};

type Contract = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  lunch_cutoff: string; // "09:30:00"
  dinner_cutoff: string; // "15:30:00"
  allow_after_cutoff: boolean | null;
  active: boolean | null;
};

type MealOrder = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  meal_date: string; // "2026-02-18"
  order_date?: string | null;
  shift: MealShift;
  status: string | null; // enum no banco
  created_by?: string | null;
  created_at?: string | null;
};

type OrderLine = {
  id: string;
  order_id: string;
  employee_id: string;
};

type Picks = Record<string, { lunch: boolean; dinner: boolean }>;

function isoLocalToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoAddDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function timeToMinutes(hhmmss: string) {
  const [hh, mm] = hhmmss.split(":");
  return parseInt(hh, 10) * 60 + parseInt(mm, 10);
}

function nowLocalMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function defaultViewByClock(): ViewMode {
  // pedido do Marcelo: almoço até 11:00, janta após
  return nowLocalMinutes() < 11 * 60 ? "ALMOCO" : "JANTA";
}

function makeEmptyPicks(employees: Employee[]): Picks {
  const p: Picks = {};
  for (const e of employees) p[e.id] = { lunch: false, dinner: false };
  return p;
}

function shallowEqualPicks(a: Picks, b: Picks) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = a[k];
    const bv = b[k];
    if (!bv) return false;
    if (av.lunch !== bv.lunch) return false;
    if (av.dinner !== bv.dinner) return false;
  }
  return true;
}

function fmtDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function safeLower(s: string) {
  return (s || "").toLowerCase();
}

export default function RefeicoesPage() {
  const [loading, setLoading] = useState(true);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [dateISO, setDateISO] = useState<string>(isoLocalToday());
  const [search, setSearch] = useState("");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());

  const [contract, setContract] = useState<Contract | null>(null);

  const [orderLunch, setOrderLunch] = useState<MealOrder | null>(null);
  const [orderDinner, setOrderDinner] = useState<MealOrder | null>(null);

  const [picks, setPicks] = useState<Picks>({});
  const [savedPicks, setSavedPicks] = useState<Picks>({});

  const [view, setView] = useState<ViewMode>(defaultViewByClock());
  const [onlyMarked, setOnlyMarked] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const okTimer = useRef<number | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addThird, setAddThird] = useState(false);

  function toastOk(msg: string) {
    setOkMsg(msg);
    if (okTimer.current) window.clearTimeout(okTimer.current);
    okTimer.current = window.setTimeout(() => setOkMsg(null), 2200);
  }

  function clearMsgs() {
    setErrorMsg(null);
    setOkMsg(null);
  }

  // ---- Auth
  useEffect(() => {
    let unsub: any = null;

    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? null;
      setUserEmail(email);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    unsub = sub.subscription;

    return () => {
      unsub?.unsubscribe?.();
    };
  }, []);

  // ---- Load base data (worksites + employees)
  useEffect(() => {
    if (!userEmail) return;

    (async () => {
      setBusy("Carregando...");
      clearMsgs();

      const { data: ws, error: wsErr } = await supabase
        .from("meal_worksites")
        .select("id,name,active")
        .order("name", { ascending: true });

      if (wsErr) {
        setBusy(null);
        setErrorMsg(wsErr.message);
        return;
      }

      setWorksites((ws ?? []) as Worksite[]);
      if (!worksiteId && ws && ws.length > 0) setWorksiteId(ws[0].id);

      const { data: emps, error: empErr } = await supabase
        .from("meal_employees")
        .select("id,full_name,active,created_at,is_third_party")
        .eq("active", true)
        .order("full_name", { ascending: true });

      if (empErr) {
        setBusy(null);
        setErrorMsg(empErr.message);
        return;
      }

      const empList = (emps ?? []) as Employee[];
      setEmployees(empList);

      const empty = makeEmptyPicks(empList);
      setPicks(empty);
      setSavedPicks(empty);

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // ---- Default view update when date changes (use clock rule mostly when date is today)
  useEffect(() => {
    if (dateISO === isoLocalToday()) {
      setView(defaultViewByClock());
    } else {
      // em dias passados/futuros, deixa "AMBOS" mais útil para conferência
      setView("AMBOS");
    }
  }, [dateISO]);

  // ---- Load favorites + contract + orders/lines
  useEffect(() => {
    if (!userEmail) return;
    if (!worksiteId) return;
    if (employees.length === 0) return;

    (async () => {
      setBusy("Sincronizando...");
      clearMsgs();

      // favorites
      const { data: fav, error: favErr } = await supabase
        .from("meal_worksite_favorites")
        .select("employee_id")
        .eq("worksite_id", worksiteId);

      if (favErr) {
        setBusy(null);
        setErrorMsg(favErr.message);
        return;
      }

      const favSet = new Set<string>((fav ?? []).map((r: any) => r.employee_id));
      setFavoriteIds(favSet);

      // contract (active first)
      const { data: cts, error: ctErr } = await supabase
        .from("meal_contracts")
        .select("id,worksite_id,restaurant_id,lunch_cutoff,dinner_cutoff,allow_after_cutoff,active")
        .eq("worksite_id", worksiteId)
        .order("active", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);

      if (ctErr) {
        setBusy(null);
        setErrorMsg(ctErr.message);
        return;
      }

      const ct = (cts && cts.length > 0 ? (cts[0] as Contract) : null) as Contract | null;
      setContract(ct);

      // orders for date
      const { data: orders, error: ordErr } = await supabase
        .from("meal_orders")
        .select("id,worksite_id,restaurant_id,meal_date,order_date,shift,status,created_at,created_by")
        .eq("worksite_id", worksiteId)
        .eq("meal_date", dateISO);

      if (ordErr) {
        setBusy(null);
        setErrorMsg(ordErr.message);
        return;
      }

      const ordList = (orders ?? []) as MealOrder[];
      const lunch = ordList.find((o) => o.shift === "ALMOCO") ?? null;
      const dinner = ordList.find((o) => o.shift === "JANTA") ?? null;
      setOrderLunch(lunch);
      setOrderDinner(dinner);

      // lines
      const empty = makeEmptyPicks(employees);
      const saved = makeEmptyPicks(employees);

      async function applyLines(order: MealOrder | null, shift: MealShift) {
        if (!order) return;
        const { data: ln, error: lnErr } = await supabase
          .from("meal_order_lines")
          .select("id,order_id,employee_id")
          .eq("order_id", order.id);

        if (lnErr) throw new Error(lnErr.message);

        const lines = (ln ?? []) as OrderLine[];
        for (const l of lines) {
          if (!saved[l.employee_id]) continue;
          if (shift === "ALMOCO") {
            saved[l.employee_id].lunch = true;
            empty[l.employee_id].lunch = true;
          } else {
            saved[l.employee_id].dinner = true;
            empty[l.employee_id].dinner = true;
          }
        }
      }

      try {
        await applyLines(lunch, "ALMOCO");
        await applyLines(dinner, "JANTA");
      } catch (e: any) {
        setBusy(null);
        setErrorMsg(e?.message || "Erro ao carregar linhas.");
        return;
      }

      setPicks(empty);
      setSavedPicks(saved);

      setBusy(null);
    })();
  }, [userEmail, worksiteId, dateISO, employees]);

  const worksiteName = useMemo(() => {
    return worksites.find((w) => w.id === worksiteId)?.name ?? "";
  }, [worksites, worksiteId]);

  const employeesSorted = useMemo(() => {
    const list = [...employees].filter((e) => e.active !== false);

    // favorito primeiro, depois normal; terceiros por último
    list.sort((a, b) => {
      const aFav = favoriteIds.has(a.id) ? 1 : 0;
      const bFav = favoriteIds.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;

      const aThird = a.is_third_party ? 1 : 0;
      const bThird = b.is_third_party ? 1 : 0;
      if (aThird !== bThird) return aThird - bThird;

      return a.full_name.localeCompare(b.full_name);
    });

    const q = safeLower(search).trim();
    if (!q) return list;
    return list.filter((e) => safeLower(e.full_name).includes(q));
  }, [employees, favoriteIds, search]);

  const currentCounts = useMemo(() => {
    let lunch = 0;
    let dinner = 0;
    for (const k of Object.keys(picks)) {
      if (picks[k]?.lunch) lunch++;
      if (picks[k]?.dinner) dinner++;
    }
    return { lunch, dinner };
  }, [picks]);

  const savedCounts = useMemo(() => {
    let lunch = 0;
    let dinner = 0;
    for (const k of Object.keys(savedPicks)) {
      if (savedPicks[k]?.lunch) lunch++;
      if (savedPicks[k]?.dinner) dinner++;
    }
    return { lunch, dinner };
  }, [savedPicks]);

  const hasChanges = useMemo(() => {
    return !shallowEqualPicks(picks, savedPicks);
  }, [picks, savedPicks]);

  const filteredForView = useMemo(() => {
    const list = employeesSorted;

    if (!onlyMarked) return list;

    if (view === "ALMOCO") return list.filter((e) => picks[e.id]?.lunch);
    if (view === "JANTA") return list.filter((e) => picks[e.id]?.dinner);
    // AMBOS
    return list.filter((e) => picks[e.id]?.lunch || picks[e.id]?.dinner);
  }, [employeesSorted, onlyMarked, view, picks]);

  function setPick(empId: string, patch: Partial<{ lunch: boolean; dinner: boolean }>) {
    setPicks((prev) => {
      const cur = prev[empId] ?? { lunch: false, dinner: false };
      return { ...prev, [empId]: { ...cur, ...patch } };
    });
  }

  function clearAllMarksUI() {
    const empty = makeEmptyPicks(employees);
    setPicks(empty);
    toastOk("Limpo (apenas tela).");
  }

  function restoreSaved() {
    setPicks(savedPicks);
    toastOk("Restaurado do salvo.");
  }

  function markAll(shift: MealShift, value: boolean) {
    setPicks((prev) => {
      const next: Picks = { ...prev };
      for (const e of filteredForView) {
        const cur = next[e.id] ?? { lunch: false, dinner: false };
        if (shift === "ALMOCO") next[e.id] = { ...cur, lunch: value };
        else next[e.id] = { ...cur, dinner: value };
      }
      return next;
    });
  }

  function canSaveShift(shift: MealShift) {
    if (!contract) return true;

    const now = nowLocalMinutes();
    const cutoff = shift === "ALMOCO" ? timeToMinutes(contract.lunch_cutoff) : timeToMinutes(contract.dinner_cutoff);
    if (now <= cutoff) return true;

    return !!contract.allow_after_cutoff;
  }

  async function ensureOrder(shift: MealShift) {
    const existing = shift === "ALMOCO" ? orderLunch : orderDinner;
    if (existing) {
      // garante restaurant_id do contrato (se tiver)
      if (contract && existing.restaurant_id !== contract.restaurant_id) {
        const { error: upErr } = await supabase
          .from("meal_orders")
          .update({ restaurant_id: contract.restaurant_id })
          .eq("id", existing.id);
        if (upErr) throw new Error(upErr.message);
      }
      return existing;
    }

    if (!contract) throw new Error("Sem contrato para esta obra.");

    const insertObj: any = {
      worksite_id: worksiteId,
      restaurant_id: contract.restaurant_id,
      meal_date: dateISO,
      order_date: dateISO,
      shift,
      status: "DRAFT", // importante: NÃO use CANCELLED (seu enum não aceita)
    };

    const { data, error } = await supabase.from("meal_orders").insert(insertObj).select("*").single();
    if (error) throw new Error(error.message);

    const created = data as MealOrder;
    if (shift === "ALMOCO") setOrderLunch(created);
    else setOrderDinner(created);

    return created;
  }

  async function saveShift(shift: MealShift) {
    clearMsgs();

    if (!canSaveShift(shift)) {
      setErrorMsg("Passou do horário limite e o contrato NÃO permite salvar após o limite.");
      return;
    }

    setBusy(`Salvando ${shift === "ALMOCO" ? "Almoço" : "Janta"}...`);

    try {
      const order = await ensureOrder(shift);

      // apaga linhas existentes do turno (na prática: order_id = turno)
      const { error: delErr } = await supabase.from("meal_order_lines").delete().eq("order_id", order.id);
      if (delErr) throw new Error(delErr.message);

      const rows: any[] = [];
      for (const e of employees) {
        const pk = picks[e.id] ?? { lunch: false, dinner: false };
        const ok = shift === "ALMOCO" ? pk.lunch : pk.dinner;
        if (ok) rows.push({ order_id: order.id, employee_id: e.id });
      }

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from("meal_order_lines").insert(rows);
        if (insErr) throw new Error(insErr.message);
      }

      // mantém status como DRAFT (seu enum está aceitando isso)
      const { error: stErr } = await supabase.from("meal_orders").update({ status: "DRAFT" }).eq("id", order.id);
      if (stErr) throw new Error(stErr.message);

      // atualiza savedPicks só no turno salvo
      setSavedPicks((prev) => {
        const next: Picks = { ...prev };
        for (const e of employees) {
          const curSaved = next[e.id] ?? { lunch: false, dinner: false };
          const curPick = picks[e.id] ?? { lunch: false, dinner: false };
          if (shift === "ALMOCO") next[e.id] = { ...curSaved, lunch: curPick.lunch };
          else next[e.id] = { ...curSaved, dinner: curPick.dinner };
        }
        return next;
      });

      toastOk(`${shift === "ALMOCO" ? "Almoço" : "Janta"} salvo.`);
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao salvar.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelShift(shift: MealShift) {
    clearMsgs();

    const order = shift === "ALMOCO" ? orderLunch : orderDinner;

    // se não existe order ainda, não tem como cancelar no banco
    if (!order) {
      // só limpa UI daquele turno
      setPicks((prev) => {
        const next: Picks = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { lunch: false, dinner: false };
          if (shift === "ALMOCO") next[e.id] = { ...cur, lunch: false };
          else next[e.id] = { ...cur, dinner: false };
        }
        return next;
      });
      setSavedPicks((prev) => {
        const next: Picks = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { lunch: false, dinner: false };
          if (shift === "ALMOCO") next[e.id] = { ...cur, lunch: false };
          else next[e.id] = { ...cur, dinner: false };
        }
        return next;
      });
      toastOk("Nada salvo para cancelar (só limpei).");
      return;
    }

    setBusy(`Cancelando ${shift === "ALMOCO" ? "Almoço" : "Janta"}...`);

    try {
      // 1) remover linhas do pedido
      const { error: delErr } = await supabase.from("meal_order_lines").delete().eq("order_id", order.id);
      if (delErr) throw new Error(delErr.message);

      // 2) manter status como DRAFT (NÃO existe CANCELLED no seu enum)
      const { error: upErr } = await supabase.from("meal_orders").update({ status: "DRAFT" }).eq("id", order.id);
      if (upErr) throw new Error(upErr.message);

      // 3) refletir na UI (zera turno)
      setPicks((prev) => {
        const next: Picks = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { lunch: false, dinner: false };
          if (shift === "ALMOCO") next[e.id] = { ...cur, lunch: false };
          else next[e.id] = { ...cur, dinner: false };
        }
        return next;
      });

      setSavedPicks((prev) => {
        const next: Picks = { ...prev };
        for (const e of employees) {
          const cur = next[e.id] ?? { lunch: false, dinner: false };
          if (shift === "ALMOCO") next[e.id] = { ...cur, lunch: false };
          else next[e.id] = { ...cur, dinner: false };
        }
        return next;
      });

      toastOk(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado (zerado).`);
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao cancelar.");
    } finally {
      setBusy(null);
    }
  }

  async function copySummary() {
    clearMsgs();

    const lunchNames: string[] = [];
    const dinnerNames: string[] = [];

    const byId = new Map(employees.map((e) => [e.id, e.full_name]));
    for (const e of employeesSorted) {
      const pk = picks[e.id] ?? { lunch: false, dinner: false };
      if (pk.lunch) lunchNames.push(byId.get(e.id) || e.full_name);
      if (pk.dinner) dinnerNames.push(byId.get(e.id) || e.full_name);
    }

    const lines: string[] = [];
    lines.push(`OBRA: ${worksiteName}`);
    lines.push(`DATA: ${fmtDateBR(dateISO)}`);
    lines.push("");
    lines.push(`ALMOÇO (${lunchNames.length})`);
    lines.push(lunchNames.length ? lunchNames.join(", ") : "— ninguém marcado —");
    lines.push("");
    lines.push(`JANTA (${dinnerNames.length})`);
    lines.push(dinnerNames.length ? dinnerNames.join(", ") : "— ninguém marcado —");

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toastOk("Resumo copiado.");
    } catch {
      setErrorMsg("Não consegui copiar (permissão do navegador).");
    }
  }

  async function copyYesterday() {
    clearMsgs();
    setBusy("Copiando ontem...");

    try {
      const yISO = isoAddDays(dateISO, -1);

      const { data: ords, error: ordErr } = await supabase
        .from("meal_orders")
        .select("id,shift")
        .eq("worksite_id", worksiteId)
        .eq("meal_date", yISO);

      if (ordErr) throw new Error(ordErr.message);

      const lunch = (ords ?? []).find((o: any) => o.shift === "ALMOCO") ?? null;
      const dinner = (ords ?? []).find((o: any) => o.shift === "JANTA") ?? null;

      const next = makeEmptyPicks(employees);

      async function apply(order: any, shift: MealShift) {
        if (!order) return;
        const { data: ln, error: lnErr } = await supabase
          .from("meal_order_lines")
          .select("employee_id")
          .eq("order_id", order.id);

        if (lnErr) throw new Error(lnErr.message);

        for (const r of ln ?? []) {
          if (!next[r.employee_id]) continue;
          if (shift === "ALMOCO") next[r.employee_id].lunch = true;
          else next[r.employee_id].dinner = true;
        }
      }

      await apply(lunch, "ALMOCO");
      await apply(dinner, "JANTA");

      setPicks(next);
      toastOk("Copiado de ontem (não salvou ainda).");
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao copiar ontem.");
    } finally {
      setBusy(null);
    }
  }

  async function addEmployee() {
    clearMsgs();
    const name = addName.trim();
    if (!name) {
      setErrorMsg("Digite o nome do funcionário.");
      return;
    }

    setBusy("Adicionando pessoa...");

    try {
      const { data, error } = await supabase
        .from("meal_employees")
        .insert({ full_name: name, active: true, is_third_party: addThird })
        .select("id,full_name,active,created_at,is_third_party")
        .single();

      if (error) throw new Error(error.message);

      setEmployees((prev) => {
        const next = [...prev, data as Employee];
        next.sort((a, b) => a.full_name.localeCompare(b.full_name));
        return next;
      });

      setPicks((prev) => ({ ...prev, [data.id]: { lunch: false, dinner: false } }));
      setSavedPicks((prev) => ({ ...prev, [data.id]: { lunch: false, dinner: false } }));

      setAddName("");
      setAddThird(false);
      setAddOpen(false);
      toastOk("Pessoa adicionada.");
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao adicionar pessoa.");
    } finally {
      setBusy(null);
    }
  }

  async function signIn() {
    clearMsgs();
    const email = loginEmail.trim();
    if (!email) return;

    setBusy("Enviando link...");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/refeicoes" : undefined },
    });
    setBusy(null);

    if (error) setErrorMsg(error.message);
    else setLoginSent(true);
  }

  async function signOut() {
    clearMsgs();
    setBusy("Saindo...");
    await supabase.auth.signOut();
    setBusy(null);
  }

  const showLunchBtn = view === "AMBOS" || view === "ALMOCO";
  const showDinnerBtn = view === "AMBOS" || view === "JANTA";

  const isLunchTimeDefault = useMemo(() => defaultViewByClock() === "ALMOCO", [dateISO]);

  // ---- UI
  if (loading) return null;

  if (!userEmail) {
    return (
      <div className="rf-page">
        <div className="rf-card rf-login">
          <div className="rf-brand">
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="rf-logo" />
            <div>
              <div className="rf-title">Refeições</div>
              <div className="rf-sub">Acesso com link por e-mail</div>
            </div>
          </div>

          <div className="rf-field">
            <label>E-mail</label>
            <input value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="seu@email.com" />
          </div>

          <button className="rf-btn rf-btn-primary" onClick={signIn} disabled={!!busy}>
            Entrar
          </button>

          {loginSent && <div className="rf-ok">Link enviado. Abra o e-mail e clique no link.</div>}
          {errorMsg && <div className="rf-err">{errorMsg}</div>}
          {busy && <div className="rf-muted">{busy}</div>}
        </div>

        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="rf-page">
      <div className="rf-top">
        <div className="rf-brand">
          <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="rf-logo" />
          <div>
            <div className="rf-title">Refeições</div>
            <div className="rf-sub">Logado: {userEmail}</div>
          </div>
        </div>

        <div className="rf-top-right">
          <div className="rf-pill">Data: {dateISO}</div>
          <button className="rf-btn rf-btn-ghost" onClick={signOut}>
            Sair
          </button>
        </div>
      </div>

      <div className="rf-card rf-filters">
        <div className="rf-grid3">
          <div className="rf-field">
            <label>Obra</label>
            <select value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rf-field">
            <label>Data</label>
            <input type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>

          <div className="rf-field">
            <label>Buscar</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome do funcionário..." />
          </div>
        </div>
      </div>

      <div className="rf-summary">
        <div className="rf-card">
          <div className="rf-card-h">Totais do dia (salvo)</div>
          <div className="rf-totals">
            <div className="rf-totalBox rf-lunchBox">
              <div className="rf-totalLabel">ALMOÇO</div>
              <div className="rf-totalNum">{savedCounts.lunch}</div>
              <div className="rf-totalSub">{savedCounts.lunch > 0 ? "salvo" : "não salvo"}</div>
              <div className="rf-totalNow">Agora: {currentCounts.lunch}</div>
            </div>

            <div className="rf-totalBox rf-dinnerBox">
              <div className="rf-totalLabel">JANTA</div>
              <div className="rf-totalNum">{savedCounts.dinner}</div>
              <div className="rf-totalSub">{savedCounts.dinner > 0 ? "salvo" : "não salvo"}</div>
              <div className="rf-totalNow">Agora: {currentCounts.dinner}</div>
            </div>
          </div>

          <div className="rf-muted rf-mt8">Já pedido (salvo) · bater o olho e conferir rápido</div>
        </div>

        <div className="rf-card">
          <div className="rf-card-h">Horário limite</div>
          <div className="rf-big">
            {contract ? `${contract.lunch_cutoff} / ${contract.dinner_cutoff}` : "—"}
          </div>
          <div className="rf-muted">Almoço / Janta</div>
          {contract && (
            <div className="rf-muted rf-mt8">
              {contract.allow_after_cutoff ? "Contrato permite após o limite." : "Contrato NÃO permite após o limite."}
            </div>
          )}
        </div>

        <div className="rf-card">
          <div className="rf-card-h">Ações rápidas</div>
          <div className="rf-actions">
            <button className="rf-btn rf-btn-ghost" onClick={copyYesterday} disabled={!!busy}>
              Copiar ontem
            </button>
            <button className="rf-btn rf-btn-ghost" onClick={copySummary} disabled={!!busy}>
              Copiar resumo
            </button>
            <button className="rf-btn rf-btn-ghost" onClick={() => setAddOpen(true)} disabled={!!busy}>
              Adicionar pessoa
            </button>
          </div>

          <div className="rf-muted rf-mt8">
            {worksiteName} · {fmtDateBR(dateISO)}
          </div>
        </div>
      </div>

      {errorMsg && <div className="rf-alert rf-alert-err">Erro: {errorMsg}</div>}
      {okMsg && <div className="rf-alert rf-alert-ok">{okMsg}</div>}

      <div className="rf-card rf-markHeader">
        <div>
          <div className="rf-card-h">Marcação</div>
          <div className="rf-muted">
            Visual app-like: por padrão abre{" "}
            <b>{dateISO === isoLocalToday() ? (isLunchTimeDefault ? "ALMOÇO (até 11h)" : "JANTA (após 11h)") : "AMBOS"}</b>.
          </div>
        </div>

        <div className="rf-rightTools">
          <label className="rf-check">
            <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} />
            <span>Mostrar só marcados</span>
          </label>
        </div>

        <div className="rf-tabs">
          <button className={`rf-tab ${view === "AMBOS" ? "on" : ""}`} onClick={() => setView("AMBOS")}>
            Ambos
          </button>
          <button className={`rf-tab ${view === "ALMOCO" ? "on" : ""}`} onClick={() => setView("ALMOCO")}>
            Almoço
          </button>
          <button className={`rf-tab ${view === "JANTA" ? "on" : ""}`} onClick={() => setView("JANTA")}>
            Janta
          </button>
        </div>

        <div className="rf-miniActions">
          {showLunchBtn && (
            <button className="rf-btn rf-btn-ghost" onClick={() => markAll("ALMOCO", true)} disabled={!!busy}>
              Todos almoço
            </button>
          )}
          {showDinnerBtn && (
            <button className="rf-btn rf-btn-ghost" onClick={() => markAll("JANTA", true)} disabled={!!busy}>
              Todos janta
            </button>
          )}
          <button className="rf-btn rf-btn-warn" onClick={clearAllMarksUI} disabled={!!busy}>
            Limpar
          </button>
        </div>
      </div>

      <div className="rf-list">
        {filteredForView.map((e) => {
          const pk = picks[e.id] ?? { lunch: false, dinner: false };
          const any = pk.lunch || pk.dinner;

          return (
            <div key={e.id} className={`rf-empCard ${any ? "on" : ""}`}>
              <div className="rf-empTop">
                <div className="rf-empName">{e.full_name}</div>
                <div className="rf-badges">
                  {favoriteIds.has(e.id) && <span className="rf-badge">favorito</span>}
                  {e.is_third_party && <span className="rf-badge rf-badge2">terceiro</span>}
                </div>
              </div>

              <div className={`rf-empBtns ${view === "AMBOS" ? "two" : "one"}`}>
                {view !== "JANTA" && (
                  <button
                    className={`rf-btnShift rf-btnLunch ${pk.lunch ? "on" : ""}`}
                    onClick={() => setPick(e.id, { lunch: !pk.lunch })}
                    disabled={!!busy}
                  >
                    {pk.lunch ? "✓ Almoço" : "+ Almoço"}
                  </button>
                )}

                {view !== "ALMOCO" && (
                  <button
                    className={`rf-btnShift rf-btnDinner ${pk.dinner ? "on" : ""}`}
                    onClick={() => setPick(e.id, { dinner: !pk.dinner })}
                    disabled={!!busy}
                  >
                    {pk.dinner ? "✓ Janta" : "+ Janta"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Action bar (botões largos) */}
      <div className="rf-actionBar">
        <button className="rf-btn rf-btn-ghost" onClick={restoreSaved} disabled={!hasChanges || !!busy}>
          Restaurar salvo
        </button>

        {view !== "JANTA" && (
          <>
            <button
              className="rf-btn rf-btn-danger"
              onClick={() => cancelShift("ALMOCO")}
              disabled={!!busy || savedCounts.lunch === 0}
              title={savedCounts.lunch === 0 ? "Nada salvo para cancelar" : "Cancela o salvo do Almoço"}
            >
              Cancelar Almoço
            </button>

            <button className="rf-btn rf-btn-primary" onClick={() => saveShift("ALMOCO")} disabled={!!busy}>
              Salvar Almoço
            </button>
          </>
        )}

        {view !== "ALMOCO" && (
          <>
            <button
              className="rf-btn rf-btn-danger"
              onClick={() => cancelShift("JANTA")}
              disabled={!!busy || savedCounts.dinner === 0}
              title={savedCounts.dinner === 0 ? "Nada salvo para cancelar" : "Cancela o salvo da Janta"}
            >
              Cancelar Janta
            </button>

            <button className="rf-btn rf-btn-primary2" onClick={() => saveShift("JANTA")} disabled={!!busy}>
              Salvar Janta
            </button>
          </>
        )}

        {busy && <div className="rf-muted rf-mt6">{busy}</div>}
      </div>

      {/* Modal add */}
      {addOpen && (
        <div className="rf-modalMask" onClick={() => setAddOpen(false)}>
          <div className="rf-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rf-modalTitle">Adicionar pessoa</div>

            <div className="rf-field">
              <label>Nome</label>
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Ex.: João Silva" />
            </div>

            <label className="rf-check">
              <input type="checkbox" checked={addThird} onChange={(e) => setAddThird(e.target.checked)} />
              <span>Terceiro</span>
            </label>

            <div className="rf-modalBtns">
              <button className="rf-btn rf-btn-ghost" onClick={() => setAddOpen(false)}>
                Fechar
              </button>
              <button className="rf-btn rf-btn-primary" onClick={addEmployee} disabled={!!busy}>
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .rf-page{
    max-width: 1100px;
    margin: 0 auto;
    padding: 18px 14px 130px;
    color:#0f172a;
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
    background: transparent;
  }

  .rf-card{
    background:#fff;
    border:1px solid rgba(15,23,42,0.08);
    border-radius:18px;
    padding:14px;
    box-shadow: 0 8px 24px rgba(15,23,42,0.06);
  }

  .rf-top{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:12px;
    margin-bottom:12px;
  }

  .rf-brand{
    display:flex;
    align-items:center;
    gap:10px;
    min-width: 0;
  }
  .rf-logo{
    width:40px;
    height:40px;
    object-fit:contain;
  }
  .rf-title{
    font-size:22px;
    font-weight:700;
    letter-spacing:-0.02em;
    line-height:1.1;
  }
  .rf-sub{
    font-size:12px;
    color:rgba(15,23,42,0.55);
    margin-top:2px;
  }
  .rf-top-right{
    display:flex;
    align-items:center;
    gap:10px;
    flex-shrink:0;
  }
  .rf-pill{
    background:rgba(15,23,42,0.04);
    border:1px solid rgba(15,23,42,0.08);
    padding:8px 10px;
    border-radius:999px;
    font-size:12px;
    color:rgba(15,23,42,0.75);
  }

  .rf-filters{ margin-bottom:12px; }
  .rf-grid3{
    display:grid;
    grid-template-columns: 1fr 180px 1fr;
    gap:12px;
  }
  @media (max-width: 820px){
    .rf-grid3{ grid-template-columns: 1fr; }
    .rf-top{ align-items:flex-start; }
    .rf-title{ font-size:20px; }
  }

  .rf-field label{
    display:block;
    font-size:12px;
    color:rgba(15,23,42,0.6);
    margin-bottom:6px;
  }
  .rf-field input, .rf-field select{
    width:100%;
    height:40px;
    border-radius:12px;
    border:1px solid rgba(15,23,42,0.12);
    padding:0 12px;
    outline:none;
    font-size:14px;
    background:#fff;
  }
  .rf-field input:focus, .rf-field select:focus{
    border-color: rgba(37,99,235,0.55);
    box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
  }

  .rf-summary{
    display:grid;
    grid-template-columns: 1.2fr 0.9fr 0.9fr;
    gap:12px;
    margin-bottom:12px;
  }
  @media (max-width: 980px){
    .rf-summary{ grid-template-columns:1fr; }
  }

  .rf-card-h{
    font-size:12px;
    color:rgba(15,23,42,0.6);
    letter-spacing:0.08em;
    text-transform:uppercase;
    font-weight:700;
    margin-bottom:10px;
  }

  .rf-totals{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap:10px;
  }

  .rf-totalBox{
    border-radius:16px;
    padding:12px;
    border:1px solid rgba(15,23,42,0.08);
  }
  .rf-lunchBox{ background: rgba(16,185,129,0.09); }
  .rf-dinnerBox{ background: rgba(59,130,246,0.09); }

  .rf-totalLabel{
    font-size:12px;
    font-weight:800;
    letter-spacing:0.08em;
    color: rgba(15,23,42,0.7);
  }
  .rf-totalNum{
    font-size:42px;
    font-weight:800;
    letter-spacing:-0.03em;
    line-height:1;
    margin-top:6px;
  }
  .rf-totalSub{
    font-size:12px;
    color: rgba(15,23,42,0.65);
    margin-top:6px;
    font-weight:600;
  }
  .rf-totalNow{
    font-size:12px;
    color: rgba(15,23,42,0.6);
    margin-top:6px;
  }

  .rf-big{
    font-size:24px;
    font-weight:750;
    letter-spacing:-0.02em;
  }

  .rf-actions{
    display:flex;
    flex-direction:column;
    gap:8px;
  }

  .rf-muted{
    font-size:12px;
    color: rgba(15,23,42,0.55);
  }
  .rf-mt6{ margin-top:6px; }
  .rf-mt8{ margin-top:8px; }

  .rf-alert{
    margin: 10px 0 12px;
    border-radius:14px;
    padding:10px 12px;
    font-size:13px;
    border:1px solid rgba(15,23,42,0.12);
  }
  .rf-alert-err{
    background: rgba(239,68,68,0.08);
    border-color: rgba(239,68,68,0.25);
    color: rgba(127,29,29,0.95);
    font-weight:600;
  }
  .rf-alert-ok{
    background: rgba(16,185,129,0.10);
    border-color: rgba(16,185,129,0.25);
    color: rgba(6,95,70,0.95);
    font-weight:650;
  }

  .rf-markHeader{
    margin-bottom:12px;
    display:grid;
    grid-template-columns: 1fr auto;
    gap:10px;
    align-items:start;
  }
  @media (max-width: 820px){
    .rf-markHeader{ grid-template-columns: 1fr; }
  }

  .rf-rightTools{
    display:flex;
    justify-content:flex-end;
    align-items:center;
  }

  .rf-check{
    display:flex;
    align-items:center;
    gap:8px;
    font-size:13px;
    color: rgba(15,23,42,0.7);
    user-select:none;
  }
  .rf-check input{ width:16px; height:16px; }

  .rf-tabs{
    grid-column: 1 / -1;
    display:flex;
    gap:8px;
    justify-content:center;
    margin-top:8px;
    flex-wrap:wrap;
  }
  .rf-tab{
    border-radius:999px;
    border:1px solid rgba(15,23,42,0.12);
    background:#fff;
    height:36px;
    padding:0 14px;
    font-weight:700;
    font-size:13px;
    color: rgba(15,23,42,0.75);
  }
  .rf-tab.on{
    background: rgba(37,99,235,0.10);
    border-color: rgba(37,99,235,0.22);
    color: rgba(30,64,175,0.95);
  }

  .rf-miniActions{
    grid-column: 1 / -1;
    display:flex;
    gap:8px;
    justify-content:center;
    flex-wrap:wrap;
    margin-top:10px;
  }

  .rf-list{
    display:grid;
    grid-template-columns: 1fr 1fr;
    gap:12px;
  }
  @media (max-width: 820px){
    .rf-list{ grid-template-columns: 1fr; }
  }

  .rf-empCard{
    background:#fff;
    border:1px solid rgba(15,23,42,0.08);
    border-radius:18px;
    padding:12px;
    box-shadow: 0 8px 20px rgba(15,23,42,0.05);
  }
  .rf-empCard.on{
    border-color: rgba(37,99,235,0.22);
  }
  .rf-empTop{
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    gap:10px;
    margin-bottom:10px;
  }
  .rf-empName{
    font-weight:800;
    font-size:13px;
    letter-spacing:0.08em;
    text-transform:uppercase;
    color: rgba(15,23,42,0.78);
  }
  .rf-badges{
    display:flex;
    gap:6px;
    align-items:center;
    flex-wrap:wrap;
    justify-content:flex-end;
  }
  .rf-badge{
    font-size:12px;
    font-weight:700;
    padding:4px 10px;
    border-radius:999px;
    background: rgba(251,146,60,0.14);
    border:1px solid rgba(251,146,60,0.22);
    color: rgba(124,45,18,0.92);
  }
  .rf-badge2{
    background: rgba(148,163,184,0.16);
    border-color: rgba(148,163,184,0.26);
    color: rgba(15,23,42,0.75);
  }

  .rf-empBtns{
    display:grid;
    gap:10px;
  }
  .rf-empBtns.two{ grid-template-columns: 1fr 1fr; }
  .rf-empBtns.one{ grid-template-columns: 1fr; }

  .rf-btnShift{
    height:52px;
    border-radius:16px;
    border:1px solid rgba(15,23,42,0.10);
    font-size:16px;
    font-weight:800;
    letter-spacing:-0.01em;
  }
  .rf-btnLunch{
    background: rgba(16,185,129,0.10);
    color: rgba(5,150,105,0.95);
  }
  .rf-btnLunch.on{
    background: rgba(16,185,129,0.22);
    border-color: rgba(16,185,129,0.35);
    color: rgba(4,120,87,0.98);
  }
  .rf-btnDinner{
    background: rgba(59,130,246,0.10);
    color: rgba(37,99,235,0.98);
  }
  .rf-btnDinner.on{
    background: rgba(59,130,246,0.20);
    border-color: rgba(59,130,246,0.32);
    color: rgba(30,64,175,0.98);
  }

  .rf-actionBar{
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(255,255,255,0.92);
    backdrop-filter: blur(8px);
    border-top:1px solid rgba(15,23,42,0.10);
    padding: 10px 14px 12px;
    display:flex;
    flex-direction:column; /* botões LARGOS, 100% */
    gap:10px;
    max-width: 1100px;
    margin: 0 auto;
  }

  .rf-btn{
    height:42px;
    border-radius:999px;
    border:1px solid rgba(15,23,42,0.12);
    padding:0 14px;
    font-size:13px;
    font-weight:750;
    background:#fff;
    color: rgba(15,23,42,0.78);
    cursor:pointer;
  }
  .rf-btn:disabled{ opacity:0.55; cursor:not-allowed; }

  .rf-btn-ghost{
    background: rgba(15,23,42,0.03);
  }
  .rf-btn-primary{
    background: rgba(16,185,129,0.95);
    border-color: rgba(16,185,129,0.95);
    color:#fff;
    height:46px;
    font-size:15px;
    font-weight:850;
  }
  .rf-btn-primary2{
    background: rgba(59,130,246,0.95);
    border-color: rgba(59,130,246,0.95);
    color:#fff;
    height:46px;
    font-size:15px;
    font-weight:850;
  }
  .rf-btn-danger{
    background: rgba(239,68,68,0.10);
    border-color: rgba(239,68,68,0.26);
    color: rgba(153,27,27,0.95);
    height:46px;
    font-size:15px;
    font-weight:850;
  }
  .rf-btn-warn{
    background: rgba(239,68,68,0.08);
    border-color: rgba(239,68,68,0.18);
    color: rgba(153,27,27,0.92);
  }

  .rf-login{
    max-width: 480px;
    margin: 50px auto;
  }
  .rf-ok{
    margin-top:10px;
    font-size:13px;
    color: rgba(6,95,70,0.95);
    background: rgba(16,185,129,0.10);
    border:1px solid rgba(16,185,129,0.22);
    border-radius:14px;
    padding:10px 12px;
    font-weight:650;
  }
  .rf-err{
    margin-top:10px;
    font-size:13px;
    color: rgba(127,29,29,0.95);
    background: rgba(239,68,68,0.08);
    border:1px solid rgba(239,68,68,0.25);
    border-radius:14px;
    padding:10px 12px;
    font-weight:650;
  }

  .rf-modalMask{
    position:fixed;
    inset:0;
    background: rgba(15,23,42,0.35);
    display:flex;
    align-items:center;
    justify-content:center;
    padding: 18px;
    z-index: 50;
  }
  .rf-modal{
    width: min(520px, 100%);
    background:#fff;
    border-radius:18px;
    border:1px solid rgba(15,23,42,0.10);
    box-shadow: 0 18px 50px rgba(15,23,42,0.25);
    padding: 14px;
  }
  .rf-modalTitle{
    font-size:16px;
    font-weight:850;
    margin-bottom:10px;
    color: rgba(15,23,42,0.85);
  }
  .rf-modalBtns{
    display:flex;
    gap:10px;
    justify-content:flex-end;
    margin-top:12px;
  }
`;

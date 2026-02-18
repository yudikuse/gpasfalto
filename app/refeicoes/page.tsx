// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";
type Tab = "ALMOCO" | "JANTA" | "AMBOS";

type WorksiteAny = Record<string, any>;

type Employee = {
  id: string;
  name: string;
  isFavorite: boolean;
};

type OrdersRow = {
  id: string;
  shift: Shift;
  restaurant_id?: string | null;
  status?: string | null;
  closed_at?: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function brFromISO(iso: string): string {
  // "YYYY-MM-DD" -> "DD/MM/YY"
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function setEq(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function cloneSet(s: Set<string>) {
  return new Set<string>(Array.from(s));
}

function displayWorksiteName(w: WorksiteAny) {
  const name =
    w?.worksite_name ??
    w?.name ??
    w?.title ??
    w?.obra ??
    w?.label ??
    "OBRA";
  const city = w?.city ?? w?.cidade ?? w?.location ?? "";
  return city ? `${name} - ${city}` : String(name);
}

function initialTabByTime(): Tab {
  const h = new Date().getHours();
  // Até 11h: almoço. Após: janta.
  return h < 11 ? "ALMOCO" : "JANTA";
}

export default function RefeicoesPage() {
  const [userEmail, setUserEmail] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [busySave, setBusySave] = useState<Shift | null>(null);
  const [busyCancel, setBusyCancel] = useState<Shift | null>(null);

  const [error, setError] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const [worksites, setWorksites] = useState<WorksiteAny[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [dateIso, setDateIso] = useState<string>(todayISO());
  const [search, setSearch] = useState<string>("");

  const [tab, setTab] = useState<Tab>(() => initialTabByTime());
  const [showOnlyMarked, setShowOnlyMarked] = useState<boolean>(false);

  const [employees, setEmployees] = useState<Employee[]>([]);

  // Contract/restaurant info (flexível para não quebrar por coluna inexistente)
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  // Saved (DB) snapshot
  const [savedOrderId, setSavedOrderId] = useState<Record<Shift, string | null>>({
    ALMOCO: null,
    JANTA: null,
  });
  const [savedSet, setSavedSet] = useState<Record<Shift, Set<string>>>({
    ALMOCO: new Set(),
    JANTA: new Set(),
  });

  // Current (UI) selection
  const [curSet, setCurSet] = useState<Record<Shift, Set<string>>>({
    ALMOCO: new Set(),
    JANTA: new Set(),
  });

  const isDirtyAlmoco = useMemo(() => !setEq(curSet.ALMOCO, savedSet.ALMOCO), [curSet.ALMOCO, savedSet.ALMOCO]);
  const isDirtyJanta = useMemo(() => !setEq(curSet.JANTA, savedSet.JANTA), [curSet.JANTA, savedSet.JANTA]);

  const currentCount = useMemo(
    () => ({
      ALMOCO: curSet.ALMOCO.size,
      JANTA: curSet.JANTA.size,
    }),
    [curSet]
  );

  const savedCount = useMemo(
    () => ({
      ALMOCO: savedSet.ALMOCO.size,
      JANTA: savedSet.JANTA.size,
    }),
    [savedSet]
  );

  // ===== styles (no padrão GP Asfalto / Materiais) =====
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
    chipRow: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center",
      justifyContent: "center",
    },
    chip: (active: boolean) => ({
      borderRadius: 999,
      border: active ? "1px solid #93c5fd" : "1px solid #e5e7eb",
      background: active ? "#eff6ff" : "#ffffff",
      color: active ? "#1d4ed8" : "#334155",
      fontWeight: 800,
      padding: "10px 14px",
      cursor: "pointer",
      fontSize: 14,
      minWidth: 92,
      textAlign: "center",
    }),
    tileWrap: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    },
    tile: (kind: Shift) => {
      const base =
        kind === "ALMOCO"
          ? { bg: "#ecfdf5", bd: "#bbf7d0", tx: "#065f46" }
          : { bg: "#eff6ff", bd: "#bfdbfe", tx: "#1e3a8a" };
      return {
        borderRadius: 18,
        border: `1px solid ${base.bd}`,
        background: base.bg,
        padding: "14px 14px",
      } as CSSProperties;
    },
    tileTitle: {
      fontSize: 12,
      fontWeight: 800,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--gp-muted)",
      marginBottom: 6,
    },
    tileNum: {
      fontSize: 34,
      lineHeight: "36px",
      fontWeight: 900,
      color: "var(--gp-text)",
    },
    tileSub: {
      marginTop: 6,
      fontSize: 13,
      color: "var(--gp-muted-soft)",
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap",
    },
    pill: (kind: "ok" | "warn") => ({
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      borderRadius: 999,
      padding: "6px 10px",
      fontSize: 12,
      fontWeight: 800,
      border: kind === "ok" ? "1px solid #bbf7d0" : "1px solid #e5e7eb",
      background: kind === "ok" ? "#dcfce7" : "#f1f5f9",
      color: kind === "ok" ? "#166534" : "#334155",
    }),
    favPill: {
      borderRadius: 999,
      border: "1px solid #fed7aa",
      background: "#fff7ed",
      color: "#9a3412",
      fontWeight: 800,
      fontSize: 12,
      padding: "6px 10px",
    },
    employeeCard: (tone: "neutral" | "lunch" | "dinner" | "both") => {
      const t =
        tone === "lunch"
          ? { bg: "#ecfdf5", bd: "#bbf7d0" }
          : tone === "dinner"
            ? { bg: "#eff6ff", bd: "#bfdbfe" }
            : tone === "both"
              ? { bg: "#f8fafc", bd: "#e2e8f0" }
              : { bg: "#ffffff", bd: "#e5e7eb" };
      return {
        borderRadius: 18,
        border: `1px solid ${t.bd}`,
        background: t.bg,
        padding: "12px 12px",
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
      } as CSSProperties;
    },
    empTop: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" },
    empName: { fontWeight: 800, fontSize: 16, color: "var(--gp-text)" },
    actionBtn: (kind: Shift, selected: boolean) => {
      const pal =
        kind === "ALMOCO"
          ? { bd: "#6ee7b7", bgOn: "#10b981", bgOff: "#ecfdf5", txOn: "#ffffff", txOff: "#065f46" }
          : { bd: "#93c5fd", bgOn: "#3b82f6", bgOff: "#eff6ff", txOn: "#ffffff", txOff: "#1e3a8a" };

      return {
        width: "100%",
        borderRadius: 16,
        border: `1px solid ${pal.bd}`,
        background: selected ? pal.bgOn : pal.bgOff,
        color: selected ? pal.txOn : pal.txOff,
        fontWeight: 900,
        padding: "14px 14px",
        cursor: "pointer",
        fontSize: 16,
      } as CSSProperties;
    },
    twoBtnRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 },
    oneBtnRow: { marginTop: 10 },
    toggleRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" },

    bottomBarWrap: {
      position: "fixed",
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      padding: "10px 12px",
      background: "rgba(248, 250, 252, 0.92)",
      backdropFilter: "blur(10px)",
      borderTop: "1px solid #e5e7eb",
    },
    bottomBar: {
      maxWidth: 980,
      margin: "0 auto",
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 10,
    },
    btnSave: (kind: Shift, disabled: boolean) => {
      const pal =
        kind === "ALMOCO"
          ? { bd: "#bbf7d0", bg: "#22c55e", sh: "0 14px 26px rgba(34, 197, 94, 0.22)" }
          : { bd: "#bfdbfe", bg: "#3b82f6", sh: "0 14px 26px rgba(59, 130, 246, 0.22)" };

      return {
        width: "100%",
        borderRadius: 18,
        border: `1px solid ${pal.bd}`,
        background: disabled ? "#e2e8f0" : pal.bg,
        color: disabled ? "#475569" : "#ffffff",
        fontWeight: 900,
        padding: "16px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 18,
        boxShadow: disabled ? "none" : pal.sh,
        opacity: disabled ? 0.9 : 1,
      } as CSSProperties;
    },
    btnCancel: (disabled: boolean) => ({
      width: "100%",
      borderRadius: 18,
      border: "1px solid #fecaca",
      background: disabled ? "#f1f5f9" : "#fef2f2",
      color: disabled ? "#94a3b8" : "#991b1b",
      fontWeight: 900,
      padding: "14px 16px",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: 16,
    }),
    btnNeutral: (disabled: boolean) => ({
      width: "100%",
      borderRadius: 18,
      border: "1px solid #e5e7eb",
      background: disabled ? "#f1f5f9" : "#ffffff",
      color: disabled ? "#94a3b8" : "#0f172a",
      fontWeight: 900,
      padding: "14px 16px",
      cursor: disabled ? "not-allowed" : "pointer",
      fontSize: 16,
    }),
    spacerBottom: { height: 180 },
  };

  // ====== data load ======
  async function loadUser() {
    const { data } = await supabase.auth.getUser();
    setUserEmail(data?.user?.email ?? "");
  }

  async function loadWorksites() {
    setError("");
    const { data, error: e } = await supabase.from("meal_worksites").select("*");
    if (e) {
      setError(e.message);
      return;
    }
    const ws = (data ?? []) as WorksiteAny[];
    ws.sort((a, b) => displayWorksiteName(a).localeCompare(displayWorksiteName(b)));
    setWorksites(ws);
    if (!worksiteId && ws.length > 0) setWorksiteId(ws[0].id);
  }

  async function loadContractRestaurantId(wsId: string) {
    // select("*") para não quebrar por colunas diferentes (ex: lunch_cutoff)
    const { data, error: e } = await supabase
      .from("meal_contracts")
      .select("*")
      .eq("worksite_id", wsId)
      .limit(1);

    if (e) return null;
    const c = (data ?? [])[0] as any;
    return (c?.restaurant_id as string | null) ?? null;
  }

  async function loadEmployees(wsId: string) {
    // tenta via vínculo da obra (favorito por obra)
    const tryMembers = await supabase
      .from("meal_worksite_members")
      .select("employee_id, is_favorite, meal_employees:employee_id (id, full_name, active)")
      .eq("worksite_id", wsId);

    if (!tryMembers.error && tryMembers.data) {
      const mapped: Employee[] = (tryMembers.data as any[])
        .map((m) => {
          const emp = m?.meal_employees;
          if (!emp?.id || !emp?.full_name) return null;
          if (emp?.active === false) return null;
          return {
            id: emp.id as string,
            name: emp.full_name as string,
            isFavorite: Boolean(m?.is_favorite),
          } as Employee;
        })
        .filter(Boolean) as Employee[];

      mapped.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      setEmployees(mapped);
      return;
    }

    // fallback: todos ativos
    const { data, error: e } = await supabase.from("meal_employees").select("id, full_name, active").eq("active", true);
    if (e) throw new Error(e.message);

    const mapped: Employee[] = (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.full_name,
      isFavorite: false,
    }));
    mapped.sort((a, b) => a.name.localeCompare(b.name));
    setEmployees(mapped);
  }

  async function loadSavedOrders(wsId: string, dIso: string, fallbackRestaurantId: string | null) {
    const { data, error: e } = await supabase
      .from("meal_orders")
      .select("id, shift, restaurant_id, status, closed_at")
      .eq("worksite_id", wsId)
      .eq("meal_date", dIso);

    if (e) throw new Error(e.message);

    const orders = (data ?? []) as OrdersRow[];

    const lunchOrder = orders.find((o) => o.shift === "ALMOCO") ?? null;
    const dinnerOrder = orders.find((o) => o.shift === "JANTA") ?? null;

    const ids = orders.map((o) => o.id);
    const lineMap: Record<string, Set<string>> = {};
    if (ids.length > 0) {
      const { data: lines, error: le } = await supabase
        .from("meal_order_lines")
        .select("meal_order_id, employee_id, included")
        .in("meal_order_id", ids);

      if (le) throw new Error(le.message);

      for (const l of lines ?? []) {
        const oid = (l as any).meal_order_id as string;
        const eid = (l as any).employee_id as string;
        const included = (l as any).included as boolean;
        if (!oid || !eid || !included) continue;
        if (!lineMap[oid]) lineMap[oid] = new Set<string>();
        lineMap[oid].add(eid);
      }
    }

    const savedLunch = lunchOrder ? lineMap[lunchOrder.id] ?? new Set<string>() : new Set<string>();
    const savedDinner = dinnerOrder ? lineMap[dinnerOrder.id] ?? new Set<string>() : new Set<string>();

    setSavedOrderId({
      ALMOCO: lunchOrder?.id ?? null,
      JANTA: dinnerOrder?.id ?? null,
    });

    setSavedSet({
      ALMOCO: savedLunch,
      JANTA: savedDinner,
    });

    // por padrão, começa com o "salvo" (pra ser rápido: só ajusta e salva de novo)
    setCurSet({
      ALMOCO: cloneSet(savedLunch),
      JANTA: cloneSet(savedDinner),
    });

    // restaurante: prioridade contrato, senão o do pedido já existente
    setRestaurantId(
      fallbackRestaurantId ??
        lunchOrder?.restaurant_id ??
        dinnerOrder?.restaurant_id ??
        null
    );

    return {
      lunchClosed: Boolean(lunchOrder?.closed_at),
      dinnerClosed: Boolean(dinnerOrder?.closed_at),
    };
  }

  async function reloadAll() {
    if (!worksiteId) return;
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const rId = await loadContractRestaurantId(worksiteId);
      await loadEmployees(worksiteId);
      await loadSavedOrders(worksiteId, dateIso, rId);
    } catch (err: any) {
      setError(err?.message ?? "Erro ao carregar dados.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUser();
    loadWorksites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, dateIso]);

  // ====== UI helpers ======
  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = employees.filter((e) => (q ? e.name.toLowerCase().includes(q) : true));

    if (!showOnlyMarked) return list;

    if (tab === "ALMOCO") return list.filter((e) => curSet.ALMOCO.has(e.id));
    if (tab === "JANTA") return list.filter((e) => curSet.JANTA.has(e.id));
    return list.filter((e) => curSet.ALMOCO.has(e.id) || curSet.JANTA.has(e.id));
  }, [employees, search, showOnlyMarked, tab, curSet]);

  function toggleEmployee(shift: Shift, employeeId: string) {
    setCurSet((prev) => {
      const next = { ...prev };
      const s = new Set(next[shift]);
      if (s.has(employeeId)) s.delete(employeeId);
      else s.add(employeeId);
      next[shift] = s;
      return next;
    });
  }

  function clearShift(shift: Shift) {
    setCurSet((prev) => ({ ...prev, [shift]: new Set() }));
  }

  function restoreShift(shift: Shift) {
    setCurSet((prev) => ({ ...prev, [shift]: cloneSet(savedSet[shift]) }));
  }

  function markAllVisible(shift: Shift) {
    setCurSet((prev) => {
      const next = { ...prev };
      const s = new Set(next[shift]);
      for (const e of filteredEmployees) s.add(e.id);
      next[shift] = s;
      return next;
    });
  }

  async function copySummary() {
    setError("");
    setInfo("");

    const ws = worksites.find((w) => w.id === worksiteId);
    const wsName = ws ? displayWorksiteName(ws) : "OBRA";
    const dBR = brFromISO(dateIso);

    // Prioriza "salvo" se existir; senão usa o que está marcado agora
    const useLunch = savedCount.ALMOCO > 0 ? savedSet.ALMOCO : curSet.ALMOCO;
    const useDinner = savedCount.JANTA > 0 ? savedSet.JANTA : curSet.JANTA;

    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    const lunchNames = Array.from(useLunch).map((id) => nameById.get(id) ?? id).sort((a, b) => a.localeCompare(b));
    const dinnerNames = Array.from(useDinner).map((id) => nameById.get(id) ?? id).sort((a, b) => a.localeCompare(b));

    const text =
      `GP ASFALTO • REFEIÇÕES\n` +
      `Obra: ${wsName}\n` +
      `Data: ${dBR}\n\n` +
      `ALMOÇO (${lunchNames.length}):\n` +
      (lunchNames.length ? lunchNames.map((n) => `- ${n}`).join("\n") : "- ninguém") +
      `\n\n` +
      `JANTA (${dinnerNames.length}):\n` +
      (dinnerNames.length ? dinnerNames.map((n) => `- ${n}`).join("\n") : "- ninguém");

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setInfo("Resumo copiado ✅");
      setTimeout(() => setInfo(""), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Não foi possível copiar.");
    }
  }

  // ====== DB actions ======
  async function ensureRestaurantIdForSave(): Promise<string> {
    const r = restaurantId;
    if (r) return r;

    // tenta pegar do contrato novamente (caso tenha carregado antes de setar)
    const r2 = await loadContractRestaurantId(worksiteId);
    if (r2) {
      setRestaurantId(r2);
      return r2;
    }

    throw new Error("Sem restaurante vinculado (meal_contracts).");
  }

  async function saveShift(shift: Shift) {
    if (!worksiteId) return;
    setError("");
    setInfo("");

    const ids = Array.from(curSet[shift]);

    setBusySave(shift);
    try {
      const rId = await ensureRestaurantIdForSave();

      // se for 0, interpreta como "cancelar" (apagar pedido do turno)
      if (ids.length === 0) {
        await cancelShift(shift);
        return;
      }

      let orderId = savedOrderId[shift];

      // cria order se não existir
      if (!orderId) {
        const ins = await supabase
          .from("meal_orders")
          .insert([
            {
              worksite_id: worksiteId,
              restaurant_id: rId,
              meal_date: dateIso,
              order_date: dateIso,
              shift,
              status: "DRAFT",
            },
          ])
          .select("id")
          .single();

        if (ins.error) throw new Error(ins.error.message);
        orderId = ins.data.id as string;
      } else {
        // se já existe, garante que está no restaurante certo (se necessário)
        // (não força update pra não esbarrar em regras)
      }

      // limpa linhas antigas
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
      if (del.error) throw new Error(del.error.message);

      // insere linhas novas
      const payload = ids.map((employee_id) => ({
        meal_order_id: orderId,
        employee_id,
        included: true,
      }));

      const insLines = await supabase.from("meal_order_lines").insert(payload);
      if (insLines.error) throw new Error(insLines.error.message);

      // atualiza snapshot salvo
      setSavedOrderId((prev) => ({ ...prev, [shift]: orderId! }));
      setSavedSet((prev) => ({ ...prev, [shift]: new Set(ids) }));

      setInfo(`${shift === "ALMOCO" ? "Almoço" : "Janta"} salvo ✅`);
      setTimeout(() => setInfo(""), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao salvar.");
    } finally {
      setBusySave(null);
    }
  }

  async function cancelShift(shift: Shift) {
    if (!worksiteId) return;
    setError("");
    setInfo("");

    const orderId = savedOrderId[shift];
    if (!orderId) {
      // nada salvo para cancelar
      setInfo(`Nada para cancelar (${shift === "ALMOCO" ? "Almoço" : "Janta"}).`);
      setTimeout(() => setInfo(""), 2500);
      // zera também o current (pra evitar “fantasma”)
      setCurSet((prev) => ({ ...prev, [shift]: new Set() }));
      return;
    }

    setBusyCancel(shift);
    try {
      // apaga lines e depois a order (evita enum CANCELLED e some do payments view)
      const delLines = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
      if (delLines.error) throw new Error(delLines.error.message);

      const delOrder = await supabase.from("meal_orders").delete().eq("id", orderId);
      if (delOrder.error) throw new Error(delOrder.error.message);

      setSavedOrderId((prev) => ({ ...prev, [shift]: null }));
      setSavedSet((prev) => ({ ...prev, [shift]: new Set() }));
      setCurSet((prev) => ({ ...prev, [shift]: new Set() }));

      setInfo(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado ✅`);
      setTimeout(() => setInfo(""), 2500);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao cancelar.");
    } finally {
      setBusyCancel(null);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  // ====== render helpers ======
  const wsSelected = worksites.find((w) => w.id === worksiteId);
  const wsLabel = wsSelected ? displayWorksiteName(wsSelected) : "";

  const bottomShift: Shift =
    tab === "JANTA" ? "JANTA" : "ALMOCO"; // no modo "AMBOS" o rodapé foca no almoço (você alterna na aba)

  const bottomDirty = bottomShift === "ALMOCO" ? isDirtyAlmoco : isDirtyJanta;
  const bottomHasSaved = Boolean(savedOrderId[bottomShift]);
  const bottomDisabledSave = busySave !== null || loading || !bottomDirty;
  const bottomDisabledCancel = busyCancel !== null || loading || !bottomHasSaved;

  // ====== UI ======
  return (
    <div className="page-root">
      <div className="page-container">
        <header className="page-header" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{ width: 90, height: 90, objectFit: "contain", border: "none", background: "transparent" }}
          />
          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main">Refeições</div>
            <div className="brand-text-sub">
              Logado: {userEmail || "—"}{" "}
              <button
                onClick={signOut}
                style={{
                  marginLeft: 10,
                  border: "1px solid #e5e7eb",
                  borderRadius: 999,
                  padding: "6px 10px",
                  background: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                  color: "#0f172a",
                }}
              >
                Sair
              </button>
            </div>
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--gp-muted-soft)" }}>
            Data: <strong>{dateIso}</strong>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Filtros</div>
              <div className="section-subtitle">Escolha obra e data. Depois é só bater o olho e marcar rápido.</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1fr", gap: 12 }}>
            <div>
              <label style={styles.label}>Obra</label>
              <select
                style={styles.select}
                value={worksiteId}
                onChange={(e) => setWorksiteId(e.target.value)}
                disabled={loading || worksites.length === 0}
              >
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {displayWorksiteName(w)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} />
            </div>

            <div>
              <label style={styles.label}>Buscar</label>
              <input
                style={styles.input}
                placeholder="Nome do funcionário..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Totais do dia</div>
              <div className="section-subtitle">Número grande = marcados agora. Pill = já salvo.</div>
            </div>
          </div>

          <div style={styles.tileWrap}>
            <div style={styles.tile("ALMOCO")}>
              <div style={styles.tileTitle}>Almoço</div>
              <div style={styles.tileNum}>{currentCount.ALMOCO}</div>
              <div style={styles.tileSub}>
                <span style={styles.pill(savedCount.ALMOCO > 0 ? "ok" : "warn")}>
                  {savedCount.ALMOCO > 0 ? `salvo: ${savedCount.ALMOCO}` : "não salvo"}
                </span>
                {isDirtyAlmoco ? <span style={styles.pill("warn")}>alterado</span> : null}
              </div>
            </div>

            <div style={styles.tile("JANTA")}>
              <div style={styles.tileTitle}>Janta</div>
              <div style={styles.tileNum}>{currentCount.JANTA}</div>
              <div style={styles.tileSub}>
                <span style={styles.pill(savedCount.JANTA > 0 ? "ok" : "warn")}>
                  {savedCount.JANTA > 0 ? `salvo: ${savedCount.JANTA}` : "não salvo"}
                </span>
                {isDirtyJanta ? <span style={styles.pill("warn")}>alterado</span> : null}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "var(--gp-muted-soft)" }}>
            Obra: <strong>{wsLabel || "—"}</strong> • {brFromISO(dateIso)}
          </div>
        </div>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">
                Visual app-like: por padrão abre <strong>{initialTabByTime() === "ALMOCO" ? "ALMOÇO" : "JANTA"}</strong>. No celular, use 1 botão grande por pessoa.
              </div>
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
                marginBottom: 10,
                fontWeight: 800,
              }}
            >
              Erro: {error}
            </div>
          ) : null}

          {info ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #bbf7d0",
                background: "#ecfdf5",
                color: "#065f46",
                marginBottom: 10,
                fontWeight: 800,
              }}
            >
              {info}
            </div>
          ) : null}

          <div style={styles.toggleRow}>
            <div style={styles.chipRow}>
              <button style={styles.chip(tab === "ALMOCO")} onClick={() => setTab("ALMOCO")}>
                Almoço
              </button>
              <button style={styles.chip(tab === "JANTA")} onClick={() => setTab("JANTA")}>
                Janta
              </button>
              <button style={styles.chip(tab === "AMBOS")} onClick={() => setTab("AMBOS")}>
                Ambos
              </button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, color: "#0f172a" }}>
              <input
                type="checkbox"
                checked={showOnlyMarked}
                onChange={(e) => setShowOnlyMarked(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              Mostrar só marcados
            </label>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
            {tab !== "JANTA" ? (
              <button style={styles.btnNeutral(loading)} onClick={() => markAllVisible("ALMOCO")} disabled={loading}>
                Todos almoço
              </button>
            ) : null}

            {tab !== "ALMOCO" ? (
              <button style={styles.btnNeutral(loading)} onClick={() => markAllVisible("JANTA")} disabled={loading}>
                Todos janta
              </button>
            ) : null}

            {tab === "ALMOCO" ? (
              <button style={styles.btnNeutral(loading || !isDirtyAlmoco)} onClick={() => restoreShift("ALMOCO")} disabled={loading || !isDirtyAlmoco}>
                Restaurar almoço salvo
              </button>
            ) : null}

            {tab === "JANTA" ? (
              <button style={styles.btnNeutral(loading || !isDirtyJanta)} onClick={() => restoreShift("JANTA")} disabled={loading || !isDirtyJanta}>
                Restaurar janta salvo
              </button>
            ) : null}

            <button
              style={styles.btnCancel(loading)}
              onClick={() => {
                if (tab === "ALMOCO") clearShift("ALMOCO");
                else if (tab === "JANTA") clearShift("JANTA");
                else {
                  clearShift("ALMOCO");
                  clearShift("JANTA");
                }
              }}
              disabled={loading}
            >
              Limpar
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          {(loading ? Array.from({ length: 6 }) : filteredEmployees).map((e: any, idx: number) => {
            if (loading) {
              return (
                <div key={`sk-${idx}`} style={styles.employeeCard("neutral")}>
                  <div style={{ height: 18, width: "55%", background: "#e2e8f0", borderRadius: 10 }} />
                  <div style={{ marginTop: 10, height: 48, background: "#f1f5f9", borderRadius: 16 }} />
                </div>
              );
            }

            const emp = e as Employee;
            const lunchOn = curSet.ALMOCO.has(emp.id);
            const dinnerOn = curSet.JANTA.has(emp.id);

            const tone: "neutral" | "lunch" | "dinner" | "both" =
              lunchOn && dinnerOn ? "both" : lunchOn ? "lunch" : dinnerOn ? "dinner" : "neutral";

            return (
              <div key={emp.id} style={styles.employeeCard(tone)}>
                <div style={styles.empTop}>
                  <div style={styles.empName}>{emp.name}</div>
                  {emp.isFavorite ? <span style={styles.favPill}>favorito</span> : null}
                </div>

                {tab === "ALMOCO" ? (
                  <div style={styles.oneBtnRow}>
                    <button style={styles.actionBtn("ALMOCO", lunchOn)} onClick={() => toggleEmployee("ALMOCO", emp.id)}>
                      {lunchOn ? "✓ Almoço" : "+ Almoço"}
                    </button>
                    {dinnerOn ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#1e3a8a", fontWeight: 800 }}>
                        Janta já marcada
                      </div>
                    ) : null}
                  </div>
                ) : tab === "JANTA" ? (
                  <div style={styles.oneBtnRow}>
                    <button style={styles.actionBtn("JANTA", dinnerOn)} onClick={() => toggleEmployee("JANTA", emp.id)}>
                      {dinnerOn ? "✓ Janta" : "+ Janta"}
                    </button>
                    {lunchOn ? (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#065f46", fontWeight: 800 }}>
                        Almoço já marcado
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div style={styles.twoBtnRow}>
                    <button style={styles.actionBtn("ALMOCO", lunchOn)} onClick={() => toggleEmployee("ALMOCO", emp.id)}>
                      {lunchOn ? "✓ Almoço" : "+ Almoço"}
                    </button>
                    <button style={styles.actionBtn("JANTA", dinnerOn)} onClick={() => toggleEmployee("JANTA", emp.id)}>
                      {dinnerOn ? "✓ Janta" : "+ Janta"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={styles.spacerBottom} />
      </div>

      {/* Bottom bar (full width, padrão “app”) */}
      <div style={styles.bottomBarWrap}>
        <div style={styles.bottomBar}>
          <button
            style={styles.btnNeutral(false)}
            onClick={copySummary}
            disabled={loading || busySave !== null || busyCancel !== null}
          >
            Copiar resumo
          </button>

          <button
            style={styles.btnSave(bottomShift, bottomDisabledSave)}
            onClick={() => saveShift(bottomShift)}
            disabled={bottomDisabledSave}
          >
            {bottomShift === "ALMOCO" ? "Salvar Almoço" : "Salvar Janta"}
          </button>

          <button
            style={styles.btnCancel(bottomDisabledCancel)}
            onClick={() => cancelShift(bottomShift)}
            disabled={bottomDisabledCancel}
          >
            {bottomShift === "ALMOCO" ? "Cancelar Almoço" : "Cancelar Janta"}
          </button>

          {/* Restaurar salvo (só quando está alterado) */}
          <button
            style={styles.btnNeutral(!bottomDirty)}
            onClick={() => restoreShift(bottomShift)}
            disabled={!bottomDirty}
          >
            Restaurar salvo
          </button>
        </div>
      </div>
    </div>
  );
}

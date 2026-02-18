// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA" | "AMBOS";

type Worksite = {
  id: string;
  name?: string | null;
  city?: string | null;
  restaurant_id?: string | null;

  // fallbacks caso o banco esteja com nomes diferentes
  nome?: string | null;
  cidade?: string | null;
  restaurante_id?: string | null;
};

type MemberRow = {
  employee_id: string;
  is_favorite?: boolean | null;
};

type Employee = {
  id: string;
  full_name: string;
  active?: boolean | null;
  is_third_party?: boolean | null;
  favorite?: boolean;
};

type MealOrder = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  meal_date: string; // YYYY-MM-DD
  shift: "ALMOCO" | "JANTA";
  status: string;
  cutoff_at: string | null;
};

type MealLine = {
  meal_order_id: string;
  employee_id: string | null;
  visitor_name: string | null;
  included: boolean | null;
};

function isoTodayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isTodayISO(iso: string) {
  return iso === isoTodayLocal();
}

function defaultShiftForNow(dateISO: string): "ALMOCO" | "JANTA" {
  // regra pedida: almoço até 11h, janta depois (só para HOJE)
  if (!isTodayISO(dateISO)) return "ALMOCO";
  const h = new Date().getHours();
  return h < 11 ? "ALMOCO" : "JANTA";
}

function worksiteLabel(w: Worksite) {
  const name = (w.name ?? w.nome ?? "").trim();
  const city = (w.city ?? w.cidade ?? "").trim();
  if (name && city) return `${name} - ${city}`;
  return name || city || "Obra";
}

function getRestaurantId(w: Worksite) {
  return (w.restaurant_id ?? w.restaurante_id ?? null) as string | null;
}

function normName(s: string) {
  return (s || "").trim();
}

export default function RefeicoesPage() {
  const [loading, setLoading] = useState(true);

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [dateISO, setDateISO] = useState<string>(isoTodayLocal());
  const [tab, setTab] = useState<Shift>("ALMOCO");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [query, setQuery] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);

  const [ordersByShift, setOrdersByShift] = useState<Record<"ALMOCO" | "JANTA", MealOrder | null>>({
    ALMOCO: null,
    JANTA: null,
  });

  const [savedSet, setSavedSet] = useState<Record<"ALMOCO" | "JANTA", Set<string>>>({
    ALMOCO: new Set(),
    JANTA: new Set(),
  });

  const [draftSet, setDraftSet] = useState<Record<"ALMOCO" | "JANTA", Set<string>>>({
    ALMOCO: new Set(),
    JANTA: new Set(),
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // --- UI styles (padronizado com material/novo)
  const ui: Record<string, CSSProperties> = {
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
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 },
    alertErr: {
      borderRadius: 14,
      padding: "10px 12px",
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#991b1b",
      fontSize: 14,
      marginBottom: 12,
    },
    alertOk: {
      borderRadius: 14,
      padding: "10px 12px",
      border: "1px solid #bbf7d0",
      background: "#f0fdf4",
      color: "#166534",
      fontSize: 14,
      marginBottom: 12,
    },
    segWrap: {
      display: "flex",
      gap: 8,
      padding: 6,
      borderRadius: 999,
      border: "1px solid #e5e7eb",
      background: "#fff",
      width: "fit-content",
    },
    segBtn: {
      borderRadius: 999,
      border: "1px solid transparent",
      background: "transparent",
      padding: "10px 14px",
      fontWeight: 800,
      cursor: "pointer",
      fontSize: 14,
      color: "#0f172a",
    },
    segBtnActiveLunch: {
      background: "#ecfdf5",
      border: "1px solid #a7f3d0",
      color: "#065f46",
    },
    segBtnActiveDinner: {
      background: "#eff6ff",
      border: "1px solid #bfdbfe",
      color: "#1d4ed8",
    },
    smallBtn: {
      borderRadius: 14,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      color: "#0f172a",
      fontWeight: 800,
      padding: "10px 12px",
      cursor: "pointer",
      fontSize: 14,
      width: "100%",
    },
    smallBtnDanger: {
      borderRadius: 14,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#991b1b",
      fontWeight: 900,
      padding: "12px 12px",
      cursor: "pointer",
      fontSize: 16,
      width: "100%",
    },
    smallBtnPrimaryLunch: {
      borderRadius: 14,
      border: "1px solid #16a34a",
      background: "#22c55e",
      color: "#ffffff",
      fontWeight: 900,
      padding: "14px 12px",
      cursor: "pointer",
      fontSize: 18,
      width: "100%",
    },
    smallBtnPrimaryDinner: {
      borderRadius: 14,
      border: "1px solid #2563eb",
      background: "#3b82f6",
      color: "#ffffff",
      fontWeight: 900,
      padding: "14px 12px",
      cursor: "pointer",
      fontSize: 18,
      width: "100%",
    },
    card: {
      borderRadius: 18,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      padding: 14,
      boxShadow: "0 10px 20px rgba(2, 6, 23, 0.06)",
    },
  };

  // --- boot
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data } = await supabase.auth.getUser();
        const u = data?.user ?? null;
        setUserEmail(u?.email ?? null);
        setUserId(u?.id ?? null);

        const { data: ws, error: wsErr } = await supabase.from("meal_worksites").select("*").order("created_at", { ascending: false });
        if (wsErr) throw new Error(wsErr.message);

        const list = (ws as any[] | null) ?? [];
        setWorksites(list as Worksite[]);

        const firstId = list?.[0]?.id ? String(list[0].id) : "";
        setWorksiteId(firstId);

        // tab default (almoço até 11; janta depois)
        setTab(defaultShiftForNow(isoTodayLocal()));
      } catch (e: any) {
        setError(e?.message || "Erro ao carregar.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // carregar funcionários + pedidos salvos ao trocar obra/data
  useEffect(() => {
    if (!worksiteId || !dateISO) return;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        // 1) membros (favoritos)
        const { data: members, error: mErr } = await supabase
          .from("meal_worksite_members")
          .select("employee_id,is_favorite")
          .eq("worksite_id", worksiteId);

        if (mErr) throw new Error(mErr.message);

        const mem = ((members as any[]) || []) as MemberRow[];
        const ids = mem.map((x) => String(x.employee_id)).filter(Boolean);

        // 2) funcionários
        if (ids.length === 0) {
          setEmployees([]);
        } else {
          const { data: emps, error: eErr } = await supabase
            .from("meal_employees")
            .select("id,full_name,active,is_third_party")
            .in("id", ids);

          if (eErr) throw new Error(eErr.message);

          const favMap = new Map<string, boolean>();
          mem.forEach((r) => favMap.set(String(r.employee_id), Boolean(r.is_favorite)));

          const list = ((emps as any[]) || [])
            .map((r) => ({
              id: String(r.id),
              full_name: String(r.full_name ?? ""),
              active: r.active ?? true,
              is_third_party: r.is_third_party ?? null,
              favorite: favMap.get(String(r.id)) ?? false,
            }))
            .filter((r) => r.active !== false)
            .sort((a, b) => {
              const fa = a.favorite ? 0 : 1;
              const fb = b.favorite ? 0 : 1;
              if (fa !== fb) return fa - fb;
              return a.full_name.localeCompare(b.full_name, "pt-BR");
            });

          setEmployees(list);
        }

        // 3) pedidos (almoço/janta) do dia
        const { data: ord, error: oErr } = await supabase
          .from("meal_orders")
          .select("id,worksite_id,restaurant_id,meal_date,shift,status,cutoff_at")
          .eq("worksite_id", worksiteId)
          .eq("meal_date", dateISO)
          .in("shift", ["ALMOCO", "JANTA"]);

        if (oErr) throw new Error(oErr.message);

        const ordList = ((ord as any[]) || []) as MealOrder[];
        const lunch = ordList.find((x) => x.shift === "ALMOCO") ?? null;
        const dinner = ordList.find((x) => x.shift === "JANTA") ?? null;
        setOrdersByShift({ ALMOCO: lunch, JANTA: dinner });

        const orderIds = ordList.map((x) => String(x.id));
        if (orderIds.length === 0) {
          const empty = { ALMOCO: new Set<string>(), JANTA: new Set<string>() };
          setSavedSet(empty);
          setDraftSet({ ALMOCO: new Set(empty.ALMOCO), JANTA: new Set(empty.JANTA) });
          return;
        }

        // 4) linhas salvas (somente employee_id)
        const { data: ln, error: lErr } = await supabase
          .from("meal_order_lines")
          .select("meal_order_id,employee_id,visitor_name,included")
          .in("meal_order_id", orderIds);

        if (lErr) throw new Error(lErr.message);

        const lines = ((ln as any[]) || []) as MealLine[];

        const sLunch = new Set<string>();
        const sDinner = new Set<string>();

        for (const r of lines) {
          const empId = r.employee_id ? String(r.employee_id) : null;
          if (!empId) continue;
          if (r.included === false) continue;

          const oid = String(r.meal_order_id);
          if (lunch?.id && oid === String(lunch.id)) sLunch.add(empId);
          if (dinner?.id && oid === String(dinner.id)) sDinner.add(empId);
        }

        const saved = { ALMOCO: sLunch, JANTA: sDinner };
        setSavedSet(saved);

        // draft começa igual ao salvo (ponto-chave para não confundir)
        setDraftSet({
          ALMOCO: new Set(saved.ALMOCO),
          JANTA: new Set(saved.JANTA),
        });

        // tab default baseado na hora (mas respeita se user já trocou)
        setTab((prev) => (prev === "AMBOS" ? prev : defaultShiftForNow(dateISO)));
      } catch (e: any) {
        setError(e?.message || "Erro ao carregar.");
      } finally {
        setBusy(false);
      }
    })();
  }, [worksiteId, dateISO]);

  // auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredEmployees = useMemo(() => {
    const q = normName(query).toLowerCase();
    const base = q
      ? employees.filter((e) => e.full_name.toLowerCase().includes(q))
      : employees;

    if (!onlyMarked) return base;

    return base.filter((e) => {
      if (tab === "ALMOCO") return draftSet.ALMOCO.has(e.id);
      if (tab === "JANTA") return draftSet.JANTA.has(e.id);
      // ambos
      return draftSet.ALMOCO.has(e.id) || draftSet.JANTA.has(e.id);
    });
  }, [employees, query, onlyMarked, tab, draftSet]);

  const draftCounts = useMemo(() => {
    return {
      ALMOCO: draftSet.ALMOCO.size,
      JANTA: draftSet.JANTA.size,
    };
  }, [draftSet]);

  const savedCounts = useMemo(() => {
    return {
      ALMOCO: savedSet.ALMOCO.size,
      JANTA: savedSet.JANTA.size,
    };
  }, [savedSet]);

  function toggleOne(shift: "ALMOCO" | "JANTA", empId: string) {
    setDraftSet((prev) => {
      const next = { ...prev };
      const s = new Set(next[shift]);
      if (s.has(empId)) s.delete(empId);
      else s.add(empId);
      next[shift] = s;
      return next;
    });
  }

  function setAll(shift: "ALMOCO" | "JANTA", on: boolean) {
    setDraftSet((prev) => {
      const next = { ...prev };
      next[shift] = on ? new Set(employees.map((e) => e.id)) : new Set();
      return next;
    });
  }

  function restoreSaved() {
    setDraftSet({
      ALMOCO: new Set(savedSet.ALMOCO),
      JANTA: new Set(savedSet.JANTA),
    });
    setToast("Restaurado do salvo.");
  }

  async function ensureOrder(shift: "ALMOCO" | "JANTA"): Promise<MealOrder> {
    const existing = ordersByShift[shift];
    if (existing) return existing;

    const ws = worksites.find((w) => String(w.id) === String(worksiteId)) ?? null;
    if (!ws) throw new Error("Obra não encontrada.");

    const restaurantId = getRestaurantId(ws);
    if (!restaurantId) throw new Error("Obra sem restaurante vinculado (restaurant_id).");

    const payload: any = {
      worksite_id: worksiteId,
      restaurant_id: restaurantId,
      meal_date: dateISO,
      shift,
      status: "DRAFT",
    };

    if (userId) {
      payload.created_by = userId;
      payload.updated_by = userId;
    }

    const { data, error } = await supabase
      .from("meal_orders")
      .insert(payload)
      .select("id,worksite_id,restaurant_id,meal_date,shift,status,cutoff_at")
      .single();

    if (error) throw new Error(error.message);

    const ord = data as any as MealOrder;
    setOrdersByShift((prev) => ({ ...prev, [shift]: ord }));
    return ord;
  }

  async function saveShift(shift: "ALMOCO" | "JANTA") {
    setError(null);
    setBusy(true);
    try {
      const ord = await ensureOrder(shift);
      const desired = Array.from(draftSet[shift]);

      // preserva visitantes (se existirem) — apaga só linhas de employee
      const del = await supabase
        .from("meal_order_lines")
        .delete()
        .eq("meal_order_id", ord.id)
        .not("employee_id", "is", null);

      if (del.error) throw new Error(del.error.message);

      if (desired.length > 0) {
        const rows = desired.map((employee_id) => ({
          meal_order_id: ord.id,
          employee_id,
          included: true,
        }));

        const ins = await supabase.from("meal_order_lines").insert(rows);
        if (ins.error) throw new Error(ins.error.message);
      }

      // recarrega salvo/draft (pra bater 100% com banco)
      await reloadSaved();

      setToast(shift === "ALMOCO" ? "Almoço salvo." : "Janta salva.");
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelShift(shift: "ALMOCO" | "JANTA") {
    setError(null);
    setBusy(true);
    try {
      const ord = ordersByShift[shift];
      if (!ord) {
        // nada salvo ainda
        setDraftSet((prev) => ({ ...prev, [shift]: new Set() }));
        setToast("Nada salvo para cancelar.");
        return;
      }

      // aqui cancela de verdade: apaga TODAS as linhas (inclusive visitantes)
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", ord.id);
      if (del.error) throw new Error(del.error.message);

      await reloadSaved();

      setToast(shift === "ALMOCO" ? "Almoço cancelado." : "Janta cancelada.");
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  async function reloadSaved() {
    // recarrega pedidos + linhas salvas do dia (sem depender de contract/coluna inexistente)
    const { data: ord, error: oErr } = await supabase
      .from("meal_orders")
      .select("id,worksite_id,restaurant_id,meal_date,shift,status,cutoff_at")
      .eq("worksite_id", worksiteId)
      .eq("meal_date", dateISO)
      .in("shift", ["ALMOCO", "JANTA"]);

    if (oErr) throw new Error(oErr.message);

    const ordList = ((ord as any[]) || []) as MealOrder[];
    const lunch = ordList.find((x) => x.shift === "ALMOCO") ?? null;
    const dinner = ordList.find((x) => x.shift === "JANTA") ?? null;
    setOrdersByShift({ ALMOCO: lunch, JANTA: dinner });

    const orderIds = ordList.map((x) => String(x.id));
    if (orderIds.length === 0) {
      const empty = { ALMOCO: new Set<string>(), JANTA: new Set<string>() };
      setSavedSet(empty);
      setDraftSet({ ALMOCO: new Set(), JANTA: new Set() });
      return;
    }

    const { data: ln, error: lErr } = await supabase
      .from("meal_order_lines")
      .select("meal_order_id,employee_id,visitor_name,included")
      .in("meal_order_id", orderIds);

    if (lErr) throw new Error(lErr.message);

    const lines = ((ln as any[]) || []) as MealLine[];

    const sLunch = new Set<string>();
    const sDinner = new Set<string>();

    for (const r of lines) {
      const empId = r.employee_id ? String(r.employee_id) : null;
      if (!empId) continue;
      if (r.included === false) continue;

      const oid = String(r.meal_order_id);
      if (lunch?.id && oid === String(lunch.id)) sLunch.add(empId);
      if (dinner?.id && oid === String(dinner.id)) sDinner.add(empId);
    }

    const saved = { ALMOCO: sLunch, JANTA: sDinner };
    setSavedSet(saved);
    setDraftSet({
      ALMOCO: new Set(saved.ALMOCO),
      JANTA: new Set(saved.JANTA),
    });
  }

  async function copyYesterday() {
    setError(null);
    setBusy(true);
    try {
      const d = new Date(dateISO + "T12:00:00");
      d.setDate(d.getDate() - 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const yISO = `${y}-${m}-${day}`;

      const { data: ord, error: oErr } = await supabase
        .from("meal_orders")
        .select("id,shift")
        .eq("worksite_id", worksiteId)
        .eq("meal_date", yISO)
        .in("shift", ["ALMOCO", "JANTA"]);

      if (oErr) throw new Error(oErr.message);

      const ordList = ((ord as any[]) || []) as { id: string; shift: "ALMOCO" | "JANTA" }[];
      const ids = ordList.map((x) => String(x.id));
      if (ids.length === 0) {
        setToast("Ontem não tem pedido salvo.");
        return;
      }

      const { data: ln, error: lErr } = await supabase
        .from("meal_order_lines")
        .select("meal_order_id,employee_id,included")
        .in("meal_order_id", ids);

      if (lErr) throw new Error(lErr.message);

      const sLunch = new Set<string>();
      const sDinner = new Set<string>();

      for (const r of (ln as any[]) || []) {
        const empId = r.employee_id ? String(r.employee_id) : null;
        if (!empId) continue;
        if (r.included === false) continue;

        const oid = String(r.meal_order_id);
        const sh = ordList.find((o) => String(o.id) === oid)?.shift;
        if (sh === "ALMOCO") sLunch.add(empId);
        if (sh === "JANTA") sDinner.add(empId);
      }

      setDraftSet({
        ALMOCO: new Set(sLunch),
        JANTA: new Set(sDinner),
      });

      setToast("Copiado de ontem (ainda não salvou).");
    } catch (e: any) {
      setError(e?.message || "Erro ao copiar ontem.");
    } finally {
      setBusy(false);
    }
  }

  function buildResumoText(): string {
    const ws = worksites.find((w) => String(w.id) === String(worksiteId));
    const title = ws ? worksiteLabel(ws) : "Obra";
    const namesById = new Map(employees.map((e) => [e.id, e.full_name]));

    const lunch = Array.from(draftSet.ALMOCO).map((id) => namesById.get(id) || id).sort((a, b) => a.localeCompare(b, "pt-BR"));
    const dinner = Array.from(draftSet.JANTA).map((id) => namesById.get(id) || id).sort((a, b) => a.localeCompare(b, "pt-BR"));

    const lines: string[] = [];
    lines.push(`📍 ${title}`);
    lines.push(`📅 ${dateISO}`);
    lines.push("");

    if (tab === "ALMOCO") {
      lines.push(`🍽️ ALMOÇO (${lunch.length})`);
      lines.push(lunch.length ? lunch.map((n) => `- ${n}`).join("\n") : "- ninguém");
      return lines.join("\n");
    }

    if (tab === "JANTA") {
      lines.push(`🌙 JANTA (${dinner.length})`);
      lines.push(dinner.length ? dinner.map((n) => `- ${n}`).join("\n") : "- ninguém");
      return lines.join("\n");
    }

    lines.push(`🍽️ ALMOÇO (${lunch.length})`);
    lines.push(lunch.length ? lunch.map((n) => `- ${n}`).join("\n") : "- ninguém");
    lines.push("");
    lines.push(`🌙 JANTA (${dinner.length})`);
    lines.push(dinner.length ? dinner.map((n) => `- ${n}`).join("\n") : "- ninguém");
    return lines.join("\n");
  }

  async function copyResumo() {
    try {
      const txt = buildResumoText();
      await navigator.clipboard.writeText(txt);
      setToast("Resumo copiado.");
    } catch {
      setToast("Não deu pra copiar (iOS antigo).");
    }
  }

  async function handleSignOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.href = "/";
    }
  }

  const currentShift: "ALMOCO" | "JANTA" = tab === "JANTA" ? "JANTA" : "ALMOCO";

  const limitLunch = "09:30";
  const limitDinner = "15:30";

  return (
    <div className="page-root">
      <div className="page-container">
        <header className="page-header" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{ width: 86, height: 86, objectFit: "contain", border: "none", background: "transparent" }}
            onError={(e) => ((e.currentTarget.style.display = "none"), null)}
          />
          <div style={{ textAlign: "center" }}>
            <div className="brand-text-main">Refeições</div>
            <div className="brand-text-sub">
              Logado: {userEmail ?? "-"}{" "}
              <button
                type="button"
                onClick={handleSignOut}
                style={{
                  marginLeft: 10,
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  padding: "6px 10px",
                  background: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Sair
              </button>
            </div>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">Escolha a obra e marque rápido. No final você confere o total antes de salvar.</div>
            </div>
          </div>

          {loading ? (
            <div style={ui.hint}>Carregando…</div>
          ) : null}

          {error ? <div style={ui.alertErr}>{error}</div> : null}
          {toast ? <div style={ui.alertOk}>{toast}</div> : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={ui.label}>Obra</label>
              <select style={ui.select} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)}>
                {worksites.map((w) => (
                  <option key={String(w.id)} value={String(w.id)}>
                    {worksiteLabel(w)}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={ui.label}>Data</label>
              <input
                style={ui.input}
                type="date"
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
              />
              <div style={ui.hint}>Almoço até 11h (padrão). Janta após 11h.</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={ui.label}>Buscar</label>
              <input
                style={ui.input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nome do funcionário…"
              />
              <div style={ui.hint}>Dica: marque e depois use “Mostrar só marcados”.</div>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
              <div style={ui.segWrap}>
                <button
                  type="button"
                  style={{
                    ...ui.segBtn,
                    ...(tab === "ALMOCO" ? ui.segBtnActiveLunch : {}),
                  }}
                  onClick={() => setTab("ALMOCO")}
                >
                  Almoço
                </button>

                <button
                  type="button"
                  style={{
                    ...ui.segBtn,
                    ...(tab === "JANTA" ? ui.segBtnActiveDinner : {}),
                  }}
                  onClick={() => setTab("JANTA")}
                >
                  Janta
                </button>

                <button
                  type="button"
                  style={{
                    ...ui.segBtn,
                    ...(tab === "AMBOS" ? { background: "#f8fafc", border: "1px solid #e2e8f0" } : {}),
                  }}
                  onClick={() => setTab("AMBOS")}
                >
                  Ambos
                </button>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, userSelect: "none" }}>
                <input
                  type="checkbox"
                  checked={onlyMarked}
                  onChange={(e) => setOnlyMarked(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                Mostrar só marcados
              </label>
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 10 }}>
              <div style={{ gridColumn: "span 12", ...ui.card }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
                    Limites: <span style={{ color: "#065f46" }}>Almoço {limitLunch}</span> •{" "}
                    <span style={{ color: "#1d4ed8" }}>Janta {limitDinner}</span>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" style={{ ...ui.smallBtn, width: "auto" }} onClick={copyYesterday} disabled={busy}>
                      Copiar ontem
                    </button>

                    <button type="button" style={{ ...ui.smallBtn, width: "auto" }} onClick={restoreSaved} disabled={busy}>
                      Restaurar salvo
                    </button>

                    {tab !== "AMBOS" ? (
                      <>
                        <button
                          type="button"
                          style={{ ...ui.smallBtn, width: "auto" }}
                          onClick={() => setAll(currentShift, true)}
                          disabled={busy}
                        >
                          Todos {tab === "ALMOCO" ? "almoço" : "janta"}
                        </button>

                        <button
                          type="button"
                          style={{ ...ui.smallBtn, width: "auto" }}
                          onClick={() => setAll(currentShift, false)}
                          disabled={busy}
                        >
                          Limpar
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 900, color: "#065f46" }}>
                    Almoço: {draftCounts.ALMOCO} (salvo: {savedCounts.ALMOCO})
                  </span>
                  <span style={{ fontWeight: 900, color: "#1d4ed8" }}>
                    Janta: {draftCounts.JANTA} (salvo: {savedCounts.JANTA})
                  </span>
                </div>
              </div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              {busy ? <div style={ui.hint}>Atualizando…</div> : null}
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gap: 10 }}>
              {filteredEmployees.map((emp) => {
                const lunchOn = draftSet.ALMOCO.has(emp.id);
                const dinnerOn = draftSet.JANTA.has(emp.id);

                const rowBase: CSSProperties = {
                  ...ui.card,
                  padding: 12,
                };

                const titleRow: CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  marginBottom: 10,
                };

                const nameStyle: CSSProperties = {
                  fontWeight: 900,
                  color: "#0f172a",
                  fontSize: 15,
                };

                const badge: CSSProperties = {
                  borderRadius: 999,
                  padding: "6px 10px",
                  border: "1px solid #fed7aa",
                  background: "#fff7ed",
                  color: "#9a3412",
                  fontWeight: 900,
                  fontSize: 12,
                  textTransform: "lowercase",
                };

                const bigBtn = (active: boolean, mode: "ALMOCO" | "JANTA"): CSSProperties => {
                  if (mode === "ALMOCO") {
                    return {
                      width: "100%",
                      borderRadius: 16,
                      border: `1px solid ${active ? "#16a34a" : "#a7f3d0"}`,
                      background: active ? "#22c55e" : "#ecfdf5",
                      color: active ? "#fff" : "#065f46",
                      fontWeight: 900,
                      padding: "14px 12px",
                      fontSize: 16,
                      cursor: "pointer",
                    };
                  }
                  return {
                    width: "100%",
                    borderRadius: 16,
                    border: `1px solid ${active ? "#2563eb" : "#bfdbfe"}`,
                    background: active ? "#3b82f6" : "#eff6ff",
                    color: active ? "#fff" : "#1d4ed8",
                    fontWeight: 900,
                    padding: "14px 12px",
                    fontSize: 16,
                    cursor: "pointer",
                  };
                };

                const pillBtn = (active: boolean, mode: "ALMOCO" | "JANTA"): CSSProperties => {
                  if (mode === "ALMOCO") {
                    return {
                      flex: 1,
                      borderRadius: 14,
                      border: `1px solid ${active ? "#16a34a" : "#a7f3d0"}`,
                      background: active ? "#22c55e" : "#ecfdf5",
                      color: active ? "#fff" : "#065f46",
                      fontWeight: 900,
                      padding: "12px 10px",
                      fontSize: 14,
                      cursor: "pointer",
                    };
                  }
                  return {
                    flex: 1,
                    borderRadius: 14,
                    border: `1px solid ${active ? "#2563eb" : "#bfdbfe"}`,
                    background: active ? "#3b82f6" : "#eff6ff",
                    color: active ? "#fff" : "#1d4ed8",
                    fontWeight: 900,
                    padding: "12px 10px",
                    fontSize: 14,
                    cursor: "pointer",
                  };
                };

                return (
                  <div key={emp.id} style={rowBase}>
                    <div style={titleRow}>
                      <div style={nameStyle}>{emp.full_name}</div>
                      {emp.favorite ? <span style={badge}>favorito</span> : null}
                    </div>

                    {tab === "ALMOCO" ? (
                      <button
                        type="button"
                        style={bigBtn(lunchOn, "ALMOCO")}
                        onClick={() => toggleOne("ALMOCO", emp.id)}
                        disabled={busy}
                      >
                        {lunchOn ? "✓ Almoço" : "+ Almoço"}
                      </button>
                    ) : null}

                    {tab === "JANTA" ? (
                      <button
                        type="button"
                        style={bigBtn(dinnerOn, "JANTA")}
                        onClick={() => toggleOne("JANTA", emp.id)}
                        disabled={busy}
                      >
                        {dinnerOn ? "✓ Janta" : "+ Janta"}
                      </button>
                    ) : null}

                    {tab === "AMBOS" ? (
                      <div style={{ display: "flex", gap: 10 }}>
                        <button type="button" style={pillBtn(lunchOn, "ALMOCO")} onClick={() => toggleOne("ALMOCO", emp.id)} disabled={busy}>
                          {lunchOn ? "✓ Almoço" : "+ Almoço"}
                        </button>
                        <button type="button" style={pillBtn(dinnerOn, "JANTA")} onClick={() => toggleOne("JANTA", emp.id)} disabled={busy}>
                          {dinnerOn ? "✓ Janta" : "+ Janta"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Totais no FINAL (como você pediu) */}
            <div style={{ gridColumn: "span 12", marginTop: 6 }}>
              <div style={{ ...ui.card, padding: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Totais a salvar (confira antes de pedir)
                </div>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div style={{ borderRadius: 16, border: "1px solid #a7f3d0", background: "#ecfdf5", padding: 12 }}>
                    <div style={{ fontWeight: 900, color: "#065f46" }}>ALMOÇO</div>
                    <div style={{ fontSize: 34, fontWeight: 950, color: "#0f172a", lineHeight: 1.05 }}>{draftCounts.ALMOCO}</div>
                    <div style={{ fontSize: 12, color: "#065f46", fontWeight: 800 }}>
                      salvo: {savedCounts.ALMOCO} • limite {limitLunch}
                    </div>
                  </div>

                  <div style={{ borderRadius: 16, border: "1px solid #bfdbfe", background: "#eff6ff", padding: 12 }}>
                    <div style={{ fontWeight: 900, color: "#1d4ed8" }}>JANTA</div>
                    <div style={{ fontSize: 34, fontWeight: 950, color: "#0f172a", lineHeight: 1.05 }}>{draftCounts.JANTA}</div>
                    <div style={{ fontSize: 12, color: "#1d4ed8", fontWeight: 800 }}>
                      salvo: {savedCounts.JANTA} • limite {limitDinner}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {tab === "ALMOCO" ? (
                    <>
                      <button type="button" style={ui.smallBtnPrimaryLunch} onClick={() => saveShift("ALMOCO")} disabled={busy}>
                        Salvar Almoço ({draftCounts.ALMOCO})
                      </button>
                      <button type="button" style={ui.smallBtnDanger} onClick={() => cancelShift("ALMOCO")} disabled={busy}>
                        Cancelar Almoço
                      </button>
                    </>
                  ) : null}

                  {tab === "JANTA" ? (
                    <>
                      <button type="button" style={ui.smallBtnPrimaryDinner} onClick={() => saveShift("JANTA")} disabled={busy}>
                        Salvar Janta ({draftCounts.JANTA})
                      </button>
                      <button type="button" style={ui.smallBtnDanger} onClick={() => cancelShift("JANTA")} disabled={busy}>
                        Cancelar Janta
                      </button>
                    </>
                  ) : null}

                  {tab === "AMBOS" ? (
                    <>
                      <button type="button" style={ui.smallBtnPrimaryLunch} onClick={() => saveShift("ALMOCO")} disabled={busy}>
                        Salvar Almoço ({draftCounts.ALMOCO})
                      </button>
                      <button type="button" style={ui.smallBtnPrimaryDinner} onClick={() => saveShift("JANTA")} disabled={busy}>
                        Salvar Janta ({draftCounts.JANTA})
                      </button>
                      <button type="button" style={ui.smallBtnDanger} onClick={() => cancelShift("ALMOCO")} disabled={busy}>
                        Cancelar Almoço
                      </button>
                      <button type="button" style={ui.smallBtnDanger} onClick={() => cancelShift("JANTA")} disabled={busy}>
                        Cancelar Janta
                      </button>
                    </>
                  ) : null}

                  <button type="button" style={ui.smallBtn} onClick={copyResumo}>
                    Copiar resumo
                  </button>

                  <div style={ui.hint}>
                    Cancelar agora **não mexe em enum**: ele apaga as linhas do pedido (e isso aparece no audit como DELETE/INSERT).
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 10, ...ui.hint }}>
            Dica de uso rápido: escolha <b>Almoço</b> ou <b>Janta</b> (padrão automático), marque, desça e confira o total no final.
          </div>
        </div>
      </div>
    </div>
  );
}

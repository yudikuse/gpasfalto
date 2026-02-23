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

type Contract = {
  id: string;
  worksite_id: string;
  restaurant_id: string;
  start_date: string | null;
  end_date: string | null;
  cutoff_lunch: string | null; // time
  cutoff_dinner: string | null; // time
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
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatBRFromISO(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function isSameISODate(a: string, b: string) {
  return a === b;
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
  const [y, m, d] = mealDateISO.split("-").map(Number);
  const parts = String(cutoffTime).split(":").map((x) => Number(x));
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  const dt = new Date(y, m - 1, d, hh, mm, ss); // local
  return dt.toISOString();
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

  if (tone === "lunch") {
    return { ...base, border: "1px solid #86efac", background: "#ecfdf5", color: "#166534" };
  }
  if (tone === "dinner") {
    return { ...base, border: "1px solid #93c5fd", background: "#eff6ff", color: "#1d4ed8" };
  }

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

  if (kind === "primaryLunch") {
    return {
      ...base,
      background: "#22c55e",
      color: "#fff",
      borderColor: "#16a34a",
      boxShadow: "0 12px 26px rgba(34, 197, 94, 0.18)",
    };
  }
  if (kind === "primaryDinner") {
    return {
      ...base,
      background: "#2563eb",
      color: "#fff",
      borderColor: "#1d4ed8",
      boxShadow: "0 12px 26px rgba(37, 99, 235, 0.18)",
    };
  }
  if (kind === "danger") {
    return { ...base, background: "#fff", color: "#991b1b", borderColor: "#fecaca" };
  }
  return { ...base, background: "#fff", color: "#0f172a", borderColor: "#e5e7eb" };
}

export default function RefeicoesPage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string>("");

  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [mode, setMode] = useState<Mode>("AMBOS");

  const [contract, setContract] = useState<Contract | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState<string>("");

  const [selectedLunch, setSelectedLunch] = useState<Set<string>>(new Set());
  const [selectedDinner, setSelectedDinner] = useState<Set<string>>(new Set());
  const [visitorsLunch, setVisitorsLunch] = useState<string[]>([]);
  const [visitorsDinner, setVisitorsDinner] = useState<string[]>([]);

  const [saved, setSaved] = useState<Record<Shift, SavedSnapshot>>({
    ALMOCO: { orderId: null, employeeIds: [], visitors: [] },
    JANTA: { orderId: null, employeeIds: [], visitors: [] },
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });
  const [canceling, setCanceling] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [canOverrideCutoff, setCanOverrideCutoff] = useState<boolean>(false);

  const limits = useMemo(() => {
    const lunch = contract?.cutoff_lunch ? timeHHMM(contract.cutoff_lunch) : "--:--";
    const dinner = contract?.cutoff_dinner ? timeHHMM(contract.cutoff_dinner) : "--:--";
    return { lunch, dinner };
  }, [contract]);

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
    chip: {
      borderRadius: 999,
      padding: "6px 10px",
      fontSize: 13,
      fontWeight: 850,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "#0f172a",
      cursor: "pointer",
      userSelect: "none",
    },
  };

  async function ensureLoggedIn() {
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u?.id) {
      router.replace("/refeicoes");
      return null;
    }
    setUserEmail(u.email || "");
    return u.id;
  }

  async function loadWorksites(uid: string) {
    const { data: links, error: e1 } = await supabase.from("meal_worksite_members").select("worksite_id,can_override_cutoff").eq("user_id", uid);
    if (e1) throw e1;

    const can = (links || []).some((r: any) => Boolean(r.can_override_cutoff));
    setCanOverrideCutoff(can);

    const ids = (links || []).map((r: any) => String(r.worksite_id)).filter(Boolean);
    if (ids.length === 0) {
      setWorksites([]);
      setWorksiteId("");
      return;
    }

    const { data: ws, error: e2 } = await supabase.from("meal_worksites").select("id,name,city,active").in("id", ids).order("name", { ascending: true });
    if (e2) throw e2;

    const list = (ws || []) as Worksite[];
    setWorksites(list);
    setWorksiteId((prev) => {
      if (prev && list.some((w) => w.id === prev)) return prev;
      return list[0]?.id ? String(list[0].id) : "";
    });
  }

  async function loadContract() {
    if (!worksiteId) {
      setContract(null);
      return;
    }

    const { data: c, error: e } = await supabase
      .from("meal_contracts")
      .select("id,worksite_id,restaurant_id,start_date,end_date,cutoff_lunch,cutoff_dinner,allow_after_cutoff,price_lunch,price_dinner")
      .eq("worksite_id", worksiteId)
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (e) throw e;
    setContract((c || null) as any);
  }

  async function loadEmployees() {
    const { data: emps, error: e } = await supabase.from("meal_employees").select("id,full_name,active,is_third_party").eq("active", true).order("full_name", { ascending: true });
    if (e) throw e;
    setEmployees((emps || []) as any);
  }

  async function fetchSavedForShift(wsId: string, rid: string, dateISO: string, shift: Shift): Promise<SavedSnapshot> {
    const snap: SavedSnapshot = { orderId: null, employeeIds: [], visitors: [] };

    const { data: o, error: e1 } = await supabase
      .from("meal_orders")
      .select("id")
      .eq("worksite_id", wsId)
      .eq("restaurant_id", rid)
      .eq("meal_date", dateISO)
      .eq("shift", shift)
      .limit(1)
      .maybeSingle();

    if (e1) throw e1;
    if (!o?.id) return snap;

    const orderId = String((o as any).id);
    snap.orderId = orderId;

    const { data: lines, error: e2 } = await supabase.from("meal_order_lines").select("employee_id,visitor_name,included").eq("meal_order_id", orderId).eq("included", true);
    if (e2) throw e2;

    const empIds: string[] = [];
    const visitors: string[] = [];
    (lines || []).forEach((r: any) => {
      if (r.employee_id) empIds.push(String(r.employee_id));
      if (r.visitor_name) visitors.push(String(r.visitor_name));
    });

    snap.employeeIds = uniq(empIds);
    snap.visitors = uniq(visitors);

    return snap;
  }

  async function refreshSaved() {
    if (!worksiteId || !contract?.restaurant_id) {
      setSaved({
        ALMOCO: { orderId: null, employeeIds: [], visitors: [] },
        JANTA: { orderId: null, employeeIds: [], visitors: [] },
      });
      return;
    }

    const rid = contract.restaurant_id;

    const [l, j] = await Promise.all([
      fetchSavedForShift(worksiteId, rid, mealDate, "ALMOCO"),
      fetchSavedForShift(worksiteId, rid, mealDate, "JANTA"),
    ]);

    setSaved({ ALMOCO: l, JANTA: j });
  }

  function clearSelection(shift: Shift) {
    if (shift === "ALMOCO") {
      setSelectedLunch(new Set());
      setVisitorsLunch([]);
    } else {
      setSelectedDinner(new Set());
      setVisitorsDinner([]);
    }
  }

  async function copyFromYesterday() {
    setError(null);
    setOkMsg(null);

    if (!worksiteId || !contract?.restaurant_id) return setError("Sem contrato ativo para esta obra."), undefined;

    try {
      const rid = contract.restaurant_id;
      const y = addDaysISO(mealDate, -1);
      const [l, j] = await Promise.all([
        fetchSavedForShift(worksiteId, rid, y, "ALMOCO"),
        fetchSavedForShift(worksiteId, rid, y, "JANTA"),
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

  async function addVisitor(targetShift: Shift) {
    const name = window.prompt("Nome do visitante (sem cadastro):")?.trim();
    if (!name) return;

    if (targetShift === "ALMOCO") setVisitorsLunch((p) => uniq([...p, name]));
    else setVisitorsDinner((p) => uniq([...p, name]));
  }

  async function saveShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!worksiteId) return setError("Selecione a obra."), undefined;
    if (!contract?.restaurant_id) return setError("Sem contrato ativo para esta obra."), undefined;

    const rid = contract.restaurant_id;
    const selectedIds = shift === "ALMOCO" ? Array.from(selectedLunch) : Array.from(selectedDinner);
    const visitors = shift === "ALMOCO" ? visitorsLunch : visitorsDinner;

    const total = selectedIds.length + visitors.length;
    if (total <= 0) return setError("Nenhuma refeição marcada para salvar."), undefined;

    setSaving((p) => ({ ...p, [shift]: true }));

    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud?.user?.id ?? null;

      const cutoffTime = shift === "ALMOCO" ? contract.cutoff_lunch : contract.cutoff_dinner;
      const cutoffAtISO = buildCutoffAtISO(mealDate, cutoffTime);
      const allowAfter = Boolean(contract.allow_after_cutoff);
      const now = new Date();

      if (cutoffAtISO && !allowAfter && !canOverrideCutoff) {
        const cutoffAt = new Date(cutoffAtISO);
        if (isSameISODate(mealDate, isoTodayLocal()) && now.getTime() > cutoffAt.getTime()) {
          throw new Error(`Fora do horário limite (${shift === "ALMOCO" ? limits.lunch : limits.dinner}).`);
        }
      }

      const { data: existing, error: e1 } = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", worksiteId)
        .eq("restaurant_id", rid)
        .eq("meal_date", mealDate)
        .eq("shift", shift)
        .limit(1)
        .maybeSingle();

      if (e1) throw e1;

      let orderId = (existing as any)?.id ? String((existing as any).id) : null;

      if (!orderId) {
        const ins = await supabase
          .from("meal_orders")
          .insert({
            worksite_id: worksiteId,
            restaurant_id: rid,
            meal_date: mealDate,
            shift,
            status: "DRAFT",
            cutoff_at: cutoffAtISO,
            created_by: userId,
            updated_by: userId,
            order_date: mealDate,
          })
          .select("id")
          .single();

        if (ins.error) throw ins.error;
        orderId = String((ins.data as any)?.id);
      } else {
        // apaga linhas antigas
        const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
        if (del.error) throw del.error;

        // ✅ REABRE o pedido ao salvar de novo (se já tinha sido confirmado pelo restaurante)
        const baseUpdate: any = {
          cutoff_at: cutoffAtISO,
          updated_by: userId,
          submitted_at: null,
          confirmed_at: null,
          closed_at: null,
          order_date: mealDate,
        };

        // tenta voltar status pra DRAFT (se existir enum)
        const up1 = await supabase
          .from("meal_orders")
          .update({ ...baseUpdate, status: "DRAFT" as any })
          .eq("id", orderId);

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

      for (const eid of selectedIds) {
        rows.push({ meal_order_id: orderId, employee_id: eid, included: true, created_by: userId, updated_by: userId });
      }
      for (const v of visitors) {
        rows.push({ meal_order_id: orderId, visitor_name: v, included: true, created_by: userId, updated_by: userId });
      }

      const insLines = await supabase.from("meal_order_lines").insert(rows);
      if (insLines.error) throw insLines.error;

      await refreshSaved();
      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} salvo com sucesso (${total}).`);
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setSaving((p) => ({ ...p, [shift]: false }));
    }
  }

  async function cancelShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!worksiteId || !contract?.restaurant_id) {
      setError("Sem contrato ativo para esta obra.");
      return;
    }

    const rid = contract.restaurant_id;
    setCanceling((p) => ({ ...p, [shift]: true }));

    try {
      let orderId = saved[shift]?.orderId || null;
      if (!orderId) {
        const snap = await fetchSavedForShift(worksiteId, rid, mealDate, shift);
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

      await refreshSaved();
      clearSelection(shift);

      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} cancelado (apagado).`);
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setCanceling((p) => ({ ...p, [shift]: false }));
    }
  }

  async function copyResumo() {
    const ws = worksites.find((w) => w.id === worksiteId);
    const wsName = ws ? `${ws.name}${ws.city ? " - " + ws.city : ""}` : "-";

    const lunchNames = employees.filter((e) => selectedLunch.has(e.id)).map((e) => e.full_name);
    const dinnerNames = employees.filter((e) => selectedDinner.has(e.id)).map((e) => e.full_name);

    const text =
      `OBRA: ${wsName}\n` +
      `DATA: ${formatBRFromISO(mealDate)}\n\n` +
      `ALMOÇO (${lunchNames.length + visitorsLunch.length}):\n` +
      (lunchNames.length ? lunchNames.map((x) => `- ${x}`).join("\n") + "\n" : "") +
      (visitorsLunch.length ? visitorsLunch.map((x) => `- (Visitante) ${x}`).join("\n") + "\n" : "") +
      `\nJANTA (${dinnerNames.length + visitorsDinner.length}):\n` +
      (dinnerNames.length ? dinnerNames.map((x) => `- ${x}`).join("\n") + "\n" : "") +
      (visitorsDinner.length ? visitorsDinner.map((x) => `- (Visitante) ${x}`).join("\n") + "\n" : "");

    await navigator.clipboard.writeText(text);
    setOkMsg("Resumo copiado.");
  }

  useEffect(() => {
    let alive = true;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const uid = await ensureLoggedIn();
        if (!uid) return;
        await loadWorksites(uid);
        await loadEmployees();
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    run();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worksiteId) return;
    (async () => {
      try {
        setLoading(true);
        await loadContract();
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar contrato.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId]);

  useEffect(() => {
    if (!worksiteId || !contract?.restaurant_id) return;
    refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, contract?.restaurant_id, mealDate]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.full_name.toLowerCase().includes(q));
  }, [employees, search]);

  const counts = useMemo(() => {
    const lunch = selectedLunch.size + visitorsLunch.length;
    const dinner = selectedDinner.size + visitorsDinner.length;
    return { lunch, dinner };
  }, [selectedLunch, selectedDinner, visitorsLunch, visitorsDinner]);

  const showLunch = mode === "ALMOCO" || mode === "AMBOS";
  const showDinner = mode === "JANTA" || mode === "AMBOS";

  function toggleEmployee(shift: Shift, id: string) {
    if (shift === "ALMOCO") {
      setSelectedLunch((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else {
      setSelectedDinner((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    }
  }

  function isSelected(shift: Shift, id: string) {
    return shift === "ALMOCO" ? selectedLunch.has(id) : selectedDinner.has(id);
  }

  const bottomSaveDisabled = useMemo(() => {
    if (!contract) return true;
    if (mode === "ALMOCO") return counts.lunch <= 0;
    if (mode === "JANTA") return counts.dinner <= 0;
    return counts.lunch + counts.dinner <= 0;
  }, [contract, mode, counts]);

  const bottomCancelDisabled = useMemo(() => {
    if (!contract) return true;
    if (mode === "ALMOCO") return !saved.ALMOCO.orderId;
    if (mode === "JANTA") return !saved.JANTA.orderId;
    return !saved.ALMOCO.orderId && !saved.JANTA.orderId;
  }, [contract, mode, saved]);

  const bottomSaveLabel = useMemo(() => {
    if (mode === "ALMOCO") return "Salvar Almoço";
    if (mode === "JANTA") return "Salvar Janta";
    return "Salvar Almoço + Janta";
  }, [mode]);

  const bottomCancelLabel = useMemo(() => {
    if (mode === "ALMOCO") return "Cancelar Almoço";
    if (mode === "JANTA") return "Cancelar Janta";
    return "Cancelar Almoço + Janta";
  }, [mode]);

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

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 48 }}>
        <header className="page-header" style={{ position: "relative", justifyContent: "center", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
            <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>
              Refeições (Obra)
            </div>
            <div className="brand-text-sub">Selecionar • Salvar • Restaurante confirma</div>
          </div>

          <div style={{ position: "absolute", right: 0, top: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>
          </div>
        </header>

        {error ? (
          <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>
            {error}
          </div>
        ) : null}

        {okMsg ? (
          <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>
            {okMsg}
          </div>
        ) : null}

        <div className="section-card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra</label>
              <select style={styles.select} value={worksiteId} onChange={(e) => setWorksiteId(e.target.value)} disabled={loading || worksites.length <= 1}>
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.city ? ` - ${w.city}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={mealDate} onChange={(e) => setMealDate(e.target.value)} disabled={loading} />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Modo</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={segBtnStyle(mode === "AMBOS", "neutral")} onClick={() => setMode("AMBOS")}>
                  Ambos
                </button>
                <button type="button" style={segBtnStyle(mode === "ALMOCO", "lunch")} onClick={() => setMode("ALMOCO")}>
                  Almoço
                </button>
                <button type="button" style={segBtnStyle(mode === "JANTA", "dinner")} onClick={() => setMode("JANTA")}>
                  Janta
                </button>
              </div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
                  <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{counts.lunch}</div>
                  <div style={{ fontSize: 12, color: "#166534" }}>Limite: {limits.lunch}</div>
                </div>

                <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
                  <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{counts.dinner}</div>
                  <div style={{ fontSize: 12, color: "#1d4ed8" }}>Limite: {limits.dinner}</div>
                </div>
              </div>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <button type="button" style={bigBtnStyle("ghost", false)} onClick={copyFromYesterday} disabled={!contract}>
                Copiar de ontem
              </button>
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Buscar funcionário</label>
              <input style={styles.input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Digite nome..." />
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Funcionários</div>
              <div className="section-subtitle">Marque quem vai comer. Visitantes podem ser adicionados.</div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {filteredEmployees.map((e) => (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid #eef2f7", background: "#fff" }}>
                <div style={{ fontWeight: 850 }}>
                  {e.full_name} {e.is_third_party ? <span style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>(Terceiro)</span> : null}
                </div>

                {showLunch ? (
                  <button
                    type="button"
                    style={{
                      ...styles.chip,
                      borderColor: isSelected("ALMOCO", e.id) ? "#86efac" : "#e5e7eb",
                      background: isSelected("ALMOCO", e.id) ? "#ecfdf5" : "#fff",
                      color: isSelected("ALMOCO", e.id) ? "#166534" : "#0f172a",
                    }}
                    onClick={() => toggleEmployee("ALMOCO", e.id)}
                  >
                    Almoço
                  </button>
                ) : (
                  <div />
                )}

                {showDinner ? (
                  <button
                    type="button"
                    style={{
                      ...styles.chip,
                      borderColor: isSelected("JANTA", e.id) ? "#93c5fd" : "#e5e7eb",
                      background: isSelected("JANTA", e.id) ? "#eff6ff" : "#fff",
                      color: isSelected("JANTA", e.id) ? "#1d4ed8" : "#0f172a",
                    }}
                    onClick={() => toggleEmployee("JANTA", e.id)}
                  >
                    Janta
                  </button>
                ) : (
                  <div />
                )}
              </div>
            ))}
          </div>

          <div style={{ height: 10 }} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button type="button" style={bigBtnStyle("ghost", false)} onClick={() => addVisitor("ALMOCO")} disabled={!showLunch}>
              + Visitante (Almoço)
            </button>
            <button type="button" style={bigBtnStyle("ghost", false)} onClick={() => addVisitor("JANTA")} disabled={!showDinner}>
              + Visitante (Janta)
            </button>
          </div>

          <div style={{ height: 10 }} />

          <button type="button" style={bigBtnStyle("primaryLunch", saving.ALMOCO)} onClick={() => saveShift("ALMOCO")} disabled={!showLunch || saving.ALMOCO || !contract}>
            {saving.ALMOCO ? "Salvando..." : "Salvar Almoço"}
          </button>

          <div style={{ height: 10 }} />

          <button type="button" style={bigBtnStyle("primaryDinner", saving.JANTA)} onClick={() => saveShift("JANTA")} disabled={!showDinner || saving.JANTA || !contract}>
            {saving.JANTA ? "Salvando..." : "Salvar Janta"}
          </button>

          <div style={{ height: 10 }} />

          <button type="button" style={bigBtnStyle("danger", false)} onClick={handleBottomCancel} disabled={bottomCancelDisabled || !contract}>
            {canceling.ALMOCO || canceling.JANTA ? "Cancelando..." : bottomCancelLabel}
          </button>

          <div style={{ height: 10 }} />

          <button type="button" style={bigBtnStyle("ghost", false)} onClick={copyResumo}>
            Copiar resumo
          </button>
        </div>
      </div>
    </div>
  );
}

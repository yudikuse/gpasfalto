// FILE: app/refeicoes/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

type WorksiteItem = {
  id: string;
  label: string;
  raw: any;
};

type Employee = {
  id: string;
  name: string;
  favorite?: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function localDateISO(d = new Date()) {
  // evita o bug do toISOString() (UTC) que pode “voltar 1 dia”
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);
  return `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
}

function addDaysISO(dateISO: string, deltaDays: number) {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  dt.setDate(dt.getDate() + deltaDays);
  return localDateISO(dt);
}

function defaultShiftByHour(now = new Date()): Shift {
  const h = now.getHours();
  // padrão: ALMOÇO até 11h (inclusive 10:59). 11:00+ vira JANTA (como você pediu)
  return h < 11 ? "ALMOCO" : "JANTA";
}

function pickAnyString(row: any, keys: string[]) {
  for (const k of keys) {
    const v = row?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function pickAnyBool(row: any, keys: string[]) {
  for (const k of keys) {
    const v = row?.[k];
    if (typeof v === "boolean") return v;
    if (v === 1 || v === 0) return Boolean(v);
  }
  return false;
}

function normalizeName(s: string) {
  const v = (s || "").trim();
  return v;
}

function setHas(set: Set<string>, id: string) {
  return set.has(id);
}

function toggleSet(prev: Set<string>, id: string) {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function setFromIds(ids: string[]) {
  return new Set(ids.filter(Boolean));
}

function sortedByName(list: Employee[]) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
}

export default function RefeicoesPage() {
  const [userEmail, setUserEmail] = useState<string>("");

  const [worksites, setWorksites] = useState<WorksiteItem[]>([]);
  const [worksiteId, setWorksiteId] = useState<string>("");

  const [dateISO, setDateISO] = useState<string>(localDateISO());
  const [shift, setShift] = useState<Shift>(() => defaultShiftByHour());

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [search, setSearch] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);

  // seleção “do que vai pedir agora”
  const [selLunch, setSelLunch] = useState<Set<string>>(new Set());
  const [selDinner, setSelDinner] = useState<Set<string>>(new Set());

  // o que está salvo no banco (pra “Restaurar salvo”)
  const [savedLunch, setSavedLunch] = useState<Set<string>>(new Set());
  const [savedDinner, setSavedDinner] = useState<Set<string>>(new Set());

  const [limits, setLimits] = useState<{ lunch?: string; dinner?: string }>({ lunch: "09:30", dinner: "15:30" });

  const [loading, setLoading] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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
    hint: { fontSize: 12, color: "var(--gp-muted-soft)", marginTop: 6 },

    pill: {
      borderRadius: 999,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      padding: "8px 12px",
      fontSize: 13,
      fontWeight: 800,
      color: "#0f172a",
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      whiteSpace: "nowrap",
    },

    btnSm: {
      borderRadius: 12,
      border: "1px solid #e5e7eb",
      background: "#fff",
      color: "#0f172a",
      fontWeight: 800,
      padding: "10px 12px",
      cursor: "pointer",
      fontSize: 13,
      whiteSpace: "nowrap",
    },

    segWrap: {
      display: "inline-flex",
      gap: 6,
      padding: 6,
      borderRadius: 16,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
    },
    segBtn: (active: boolean, tone: "lunch" | "dinner") => {
      const activeBg = tone === "lunch" ? "#ecfdf5" : "#eff6ff";
      const activeBd = tone === "lunch" ? "#86efac" : "#93c5fd";
      const activeTx = tone === "lunch" ? "#166534" : "#1d4ed8";
      return {
        borderRadius: 12,
        border: `1px solid ${active ? activeBd : "#e5e7eb"}`,
        background: active ? activeBg : "#fff",
        color: active ? activeTx : "#0f172a",
        fontWeight: 900,
        padding: "10px 12px",
        cursor: "pointer",
        fontSize: 13,
        minWidth: 90,
      } as CSSProperties;
    },

    employeeCard: (state: "none" | "lunch" | "dinner" | "both") => {
      const bg =
        state === "lunch"
          ? "#ecfdf5"
          : state === "dinner"
          ? "#eff6ff"
          : state === "both"
          ? "#f8fafc"
          : "#ffffff";
      const bd =
        state === "lunch"
          ? "#86efac"
          : state === "dinner"
          ? "#93c5fd"
          : state === "both"
          ? "#e5e7eb"
          : "#e5e7eb";
      return {
        borderRadius: 18,
        border: `1px solid ${bd}`,
        background: bg,
        padding: 14,
        boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)",
      } as CSSProperties;
    },

    chip: (active: boolean, tone: "lunch" | "dinner") => {
      const onBg = tone === "lunch" ? "#22c55e" : "#3b82f6";
      const onBd = tone === "lunch" ? "#16a34a" : "#2563eb";
      const onTx = "#ffffff";

      const offBg = tone === "lunch" ? "#ecfdf5" : "#eff6ff";
      const offBd = tone === "lunch" ? "#86efac" : "#93c5fd";
      const offTx = tone === "lunch" ? "#166534" : "#1d4ed8";

      return {
        width: "100%",
        borderRadius: 14,
        border: `1px solid ${active ? onBd : offBd}`,
        background: active ? onBg : offBg,
        color: active ? onTx : offTx,
        fontWeight: 900,
        padding: "12px 12px",
        cursor: "pointer",
        fontSize: 14,
      } as CSSProperties;
    },

    bigPrimary: (tone: "lunch" | "dinner") => {
      const bg = tone === "lunch" ? "#22c55e" : "#3b82f6";
      const bd = tone === "lunch" ? "#16a34a" : "#2563eb";
      return {
        width: "100%",
        borderRadius: 16,
        border: `1px solid ${bd}`,
        background: bg,
        color: "#fff",
        fontWeight: 900,
        padding: "14px 14px",
        cursor: "pointer",
        fontSize: 16,
      } as CSSProperties;
    },
    bigDanger: {
      width: "100%",
      borderRadius: 16,
      border: "1px solid #fecaca",
      background: "#fef2f2",
      color: "#991b1b",
      fontWeight: 900,
      padding: "14px 14px",
      cursor: "pointer",
      fontSize: 16,
    } as CSSProperties,
    bigGhost: {
      width: "100%",
      borderRadius: 16,
      border: "1px solid #e5e7eb",
      background: "#ffffff",
      color: "#0f172a",
      fontWeight: 900,
      padding: "14px 14px",
      cursor: "pointer",
      fontSize: 16,
    } as CSSProperties,
  };

  const activeSel = shift === "ALMOCO" ? selLunch : selDinner;
  const activeSaved = shift === "ALMOCO" ? savedLunch : savedDinner;

  const selectedLunchCount = selLunch.size;
  const selectedDinnerCount = selDinner.size;

  const savedLunchCount = savedLunch.size;
  const savedDinnerCount = savedDinner.size;

  function employeeState(eid: string) {
    const l = selLunch.has(eid);
    const d = selDinner.has(eid);
    if (l && d) return "both";
    if (l) return "lunch";
    if (d) return "dinner";
    return "none";
  }

  const filteredEmployees = useMemo(() => {
    const q = (search || "").trim().toLowerCase();

    const list = employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;

      if (onlyMarked) {
        // no mobile: “mostrar só marcados” deve respeitar o turno que está aberto
        if (shift === "ALMOCO") return selLunch.has(e.id);
        if (shift === "JANTA") return selDinner.has(e.id);
      }
      return true;
    });

    return list;
  }, [employees, search, onlyMarked, shift, selLunch, selDinner]);

  async function loadUser() {
    try {
      const { data } = await supabase.auth.getUser();
      const email = data?.user?.email || "";
      setUserEmail(email);
    } catch {
      setUserEmail("");
    }
  }

  function worksiteLabel(raw: any) {
    const name = pickAnyString(raw, ["name", "obra", "title", "nome", "display_name", "label"]) || "OBRA";
    const city = pickAnyString(raw, ["city", "cidade", "municipio", "local"]) || "";
    const uf = pickAnyString(raw, ["uf", "estado"]) || "";
    const extra = [city, uf].filter(Boolean).join(" • ");
    return extra ? `${name} • ${extra}` : name;
  }

  async function loadWorksites() {
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.from("meal_worksites").select("*");
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      const items: WorksiteItem[] = rows
        .map((r: any) => {
          const id = String(r?.id || "").trim();
          if (!id) return null;
          return { id, label: worksiteLabel(r), raw: r } as WorksiteItem;
        })
        .filter(Boolean) as any;

      const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));
      setWorksites(sorted);

      if (!worksiteId && sorted.length) {
        setWorksiteId(sorted[0].id);
      }
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar obras (worksites).");
    } finally {
      setLoading(false);
    }
  }

  function guessEmployeeIdFromMemberRow(r: any): string {
    return pickAnyString(r, ["employee_id", "meal_employee_id", "employee", "employee_uuid", "employee_fk", "member_employee_id", "id"]);
  }
  function guessEmployeeNameFromRow(r: any): string {
    return normalizeName(
      pickAnyString(r, ["employee_name", "name", "nome", "full_name", "display_name", "visitor_name", "apelido"])
    );
  }

  async function loadEmployeesForWorksite(wsId: string) {
    setError(null);
    setInfo(null);
    setLoadingEmployees(true);
    try {
      // 1) tenta view pronta (se existir)
      const viewCandidates = ["meal_worksite_members_v", "meal_worksite_employees_v", "meal_worksite_members_view"];
      for (const v of viewCandidates) {
        const res = await supabase.from(v as any).select("*").eq("worksite_id", wsId);
        if (!res.error && Array.isArray(res.data) && res.data.length) {
          const list = res.data
            .map((r: any) => {
              const id = guessEmployeeIdFromMemberRow(r);
              const name = guessEmployeeNameFromRow(r);
              if (!id) return null;
              return {
                id,
                name: name || `Funcionário ${id.slice(0, 6)}`,
                favorite: pickAnyBool(r, ["favorite", "favorito", "is_favorite", "starred"]),
              } as Employee;
            })
            .filter(Boolean) as Employee[];

          setEmployees(sortedByName(list));
          return;
        }
      }

      // 2) membership table (SEM pedir coluna específica -> evita seu erro)
      const membersRes = await supabase.from("meal_worksite_members").select("*").eq("worksite_id", wsId);
      if (!membersRes.error && Array.isArray(membersRes.data) && membersRes.data.length) {
        // se já vier nome junto, usamos direto
        const direct = membersRes.data
          .map((r: any) => {
            const id = guessEmployeeIdFromMemberRow(r);
            const name = guessEmployeeNameFromRow(r);
            if (!id) return null;
            return {
              id,
              name: name || "",
              favorite: pickAnyBool(r, ["favorite", "favorito", "is_favorite", "starred"]),
            } as Employee;
          })
          .filter(Boolean) as Employee[];

        const hasNames = direct.some((x) => (x.name || "").trim().length >= 2);

        if (hasNames) {
          setEmployees(sortedByName(direct.map((x) => ({ ...x, name: x.name || `Funcionário ${x.id.slice(0, 6)}` }))));
          return;
        }

        // se NÃO veio nome, tenta buscar no meal_employees
        const ids = Array.from(new Set(direct.map((x) => x.id).filter(Boolean)));
        if (ids.length) {
          const empRes = await supabase.from("meal_employees").select("*").in("id", ids);
          if (!empRes.error && Array.isArray(empRes.data) && empRes.data.length) {
            const map = new Map<string, any>();
            for (const r of empRes.data as any[]) map.set(String(r?.id || ""), r);

            const list: Employee[] = ids.map((id) => {
              const r = map.get(id) || {};
              const name = normalizeName(pickAnyString(r, ["name", "employee_name", "nome", "full_name", "display_name"])) || `Funcionário ${id.slice(0, 6)}`;
              const favorite = pickAnyBool(r, ["favorite", "favorito", "is_favorite", "starred"]);
              return { id, name, favorite };
            });

            setEmployees(sortedByName(list));
            return;
          }
        }
      }

      // 3) fallback: lista geral (sem quebrar)
      const allRes = await supabase.from("meal_employees").select("*");
      if (allRes.error) throw allRes.error;

      const list = (allRes.data as any[]).map((r: any) => {
        const id = String(r?.id || "").trim();
        const name = normalizeName(pickAnyString(r, ["name", "employee_name", "nome", "full_name", "display_name"])) || `Funcionário ${id.slice(0, 6)}`;
        const favorite = pickAnyBool(r, ["favorite", "favorito", "is_favorite", "starred"]);
        return { id, name, favorite } as Employee;
      });

      setEmployees(sortedByName(list));
      setInfo("Obs.: não consegui filtrar por obra (fallback). Me diga o schema que eu ajusto fino.");
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar funcionários.");
    } finally {
      setLoadingEmployees(false);
    }
  }

  async function getOrCreateOrderId(wsId: string, dtISO: string, sh: Shift): Promise<string> {
    // tenta pegar existente
    const q = await supabase
      .from("meal_orders")
      .select("id")
      .eq("worksite_id", wsId)
      .eq("date", dtISO)
      .eq("shift", sh)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!q.error && q.data?.id) return String(q.data.id);

    // cria
    const ins = await supabase
      .from("meal_orders")
      .insert({
        worksite_id: wsId,
        date: dtISO,
        shift: sh,
        status: "DRAFT",
      })
      .select("id")
      .single();

    if (ins.error) throw ins.error;
    return String(ins.data?.id);
  }

  async function loadSavedForBothShifts(wsId: string, dtISO: string) {
    setError(null);
    setInfo(null);

    async function loadOne(sh: Shift): Promise<Set<string>> {
      const ord = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", wsId)
        .eq("date", dtISO)
        .eq("shift", sh)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ord.error || !ord.data?.id) return new Set();

      const lines = await supabase
        .from("meal_order_lines")
        .select("employee_id,included")
        .eq("meal_order_id", String(ord.data.id));

      if (lines.error || !Array.isArray(lines.data)) return new Set();

      const ids = (lines.data as any[])
        .filter((r) => r?.included === true)
        .map((r) => String(r?.employee_id || ""))
        .filter(Boolean);

      return setFromIds(ids);
    }

    const [l, d] = await Promise.all([loadOne("ALMOCO"), loadOne("JANTA")]);

    setSavedLunch(l);
    setSavedDinner(d);

    // por padrão, quando entra no dia/obra, a seleção mostra o que está salvo (pra não confundir)
    setSelLunch(new Set(l));
    setSelDinner(new Set(d));
  }

  async function copySummary() {
    const namesById = new Map<string, string>();
    for (const e of employees) namesById.set(e.id, e.name);

    const lunchNames = Array.from(selLunch).map((id) => namesById.get(id) || id);
    const dinnerNames = Array.from(selDinner).map((id) => namesById.get(id) || id);

    const msg =
      `OBRA: ${worksites.find((w) => w.id === worksiteId)?.label || "-"}\n` +
      `DATA: ${dateISO}\n\n` +
      `ALMOÇO (${lunchNames.length}):\n${lunchNames.length ? lunchNames.join("\n") : "— ninguém —"}\n\n` +
      `JANTA (${dinnerNames.length}):\n${dinnerNames.length ? dinnerNames.join("\n") : "— ninguém —"}\n`;

    try {
      await navigator.clipboard.writeText(msg);
      setInfo("Resumo copiado.");
    } catch {
      // fallback
      window.prompt("Copie o resumo:", msg);
    }
  }

  async function restoreSavedActive() {
    if (shift === "ALMOCO") setSelLunch(new Set(savedLunch));
    else setSelDinner(new Set(savedDinner));
    setInfo("Restaurado do salvo.");
  }

  async function clearActiveLocal() {
    if (shift === "ALMOCO") setSelLunch(new Set());
    else setSelDinner(new Set());
    setInfo("Limpo (somente local).");
  }

  async function copyYesterdayActive() {
    if (!worksiteId) return;
    setError(null);
    setInfo(null);
    setSaving(true);
    try {
      const y = addDaysISO(dateISO, -1);

      const ord = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", worksiteId)
        .eq("date", y)
        .eq("shift", shift)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ord.error || !ord.data?.id) {
        setInfo("Ontem não tem nada salvo nesse turno.");
        return;
      }

      const lines = await supabase
        .from("meal_order_lines")
        .select("employee_id,included")
        .eq("meal_order_id", String(ord.data.id));

      if (lines.error || !Array.isArray(lines.data)) {
        setInfo("Não consegui ler as linhas de ontem.");
        return;
      }

      const ids = (lines.data as any[])
        .filter((r) => r?.included === true)
        .map((r) => String(r?.employee_id || ""))
        .filter(Boolean);

      const setIds = setFromIds(ids);

      if (shift === "ALMOCO") setSelLunch(setIds);
      else setSelDinner(setIds);

      setInfo("Copiado de ontem (só local). Confira e salve.");
    } finally {
      setSaving(false);
    }
  }

  async function saveActive() {
    if (!worksiteId) return;
    setError(null);
    setInfo(null);
    setSaving(true);

    try {
      const orderId = await getOrCreateOrderId(worksiteId, dateISO, shift);

      // apaga o que tinha e recria (simples + audit limpinho INSERT/DELETE)
      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", orderId);
      if (del.error) throw del.error;

      const ids = Array.from(activeSel);

      if (ids.length) {
        const rows = ids.map((eid) => ({
          meal_order_id: orderId,
          employee_id: eid,
          included: true,
        }));

        const ins = await supabase.from("meal_order_lines").insert(rows);
        if (ins.error) throw ins.error;
      }

      setInfo("Salvo.");
      await loadSavedForBothShifts(worksiteId, dateISO);
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelActive() {
    if (!worksiteId) return;
    setError(null);
    setInfo(null);
    setCancelling(true);

    try {
      // cancelar = apagar linhas (NÃO mexe em enum/status)
      const ord = await supabase
        .from("meal_orders")
        .select("id")
        .eq("worksite_id", worksiteId)
        .eq("date", dateISO)
        .eq("shift", shift)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (ord.error || !ord.data?.id) {
        setInfo("Nada salvo para cancelar.");
        return;
      }

      const del = await supabase.from("meal_order_lines").delete().eq("meal_order_id", String(ord.data.id));
      if (del.error) throw del.error;

      setInfo("Cancelado (linhas apagadas).");
      await loadSavedForBothShifts(worksiteId, dateISO);
    } catch (e: any) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setCancelling(false);
    }
  }

  function toggleEmployee(eid: string, which: Shift) {
    if (which === "ALMOCO") setSelLunch((p) => toggleSet(p, eid));
    else setSelDinner((p) => toggleSet(p, eid));
  }

  async function signOut() {
    try {
      await supabase.auth.signOut();
    } finally {
      window.location.reload();
    }
  }

  useEffect(() => {
    loadUser();
    loadWorksites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!worksiteId) return;
    loadEmployeesForWorksite(worksiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId]);

  useEffect(() => {
    if (!worksiteId) return;
    loadSavedForBothShifts(worksiteId, dateISO);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worksiteId, dateISO]);

  // fixa o “padrão automático” só quando o usuário troca o dia (sem ficar mudando sozinho toda hora)
  useEffect(() => {
    setShift(defaultShiftByHour());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateISO]);

  const bottomPadding = 220;

  return (
    <div className="page-root">
      <div className="page-container">
        <header
          className="page-header"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 44, height: 44, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div>
              <div className="brand-text-main">Refeições</div>
              <div className="brand-text-sub">Logado: {userEmail || "-"}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={styles.pill}>
              Data: <span style={{ fontWeight: 900 }}>{dateISO}</span>
            </div>
            <button type="button" style={styles.btnSm} onClick={signOut}>
              Sair
            </button>
          </div>
        </header>

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">Marque rápido e confira o total no final antes de salvar.</div>
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
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          ) : null}

          {info ? (
            <div
              style={{
                borderRadius: 14,
                padding: "10px 12px",
                border: "1px solid #bbf7d0",
                background: "#f0fdf4",
                color: "#166534",
                fontSize: 14,
                marginBottom: 12,
              }}
            >
              {info}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Obra</label>
              <select
                style={styles.select}
                value={worksiteId}
                onChange={(e) => setWorksiteId(e.target.value)}
                disabled={loading}
              >
                {worksites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input
                style={styles.input}
                type="date"
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
              />
              <div style={styles.hint}>Almoço até 11h (padrão). Janta após 11h.</div>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Buscar</label>
              <input
                style={styles.input}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Nome do funcionário..."
              />
              <div style={styles.hint}>Dica: marque e depois use “Mostrar só marcados”.</div>
            </div>

            <div style={{ gridColumn: "span 12", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={styles.segWrap}>
                  <button
                    type="button"
                    style={styles.segBtn(shift === "ALMOCO", "lunch")}
                    onClick={() => setShift("ALMOCO")}
                  >
                    Almoço
                  </button>
                  <button
                    type="button"
                    style={styles.segBtn(shift === "JANTA", "dinner")}
                    onClick={() => setShift("JANTA")}
                  >
                    Janta
                  </button>
                </div>

                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, userSelect: "none" }}>
                  <input
                    type="checkbox"
                    checked={onlyMarked}
                    onChange={(e) => setOnlyMarked(e.target.checked)}
                    style={{ width: 18, height: 18 }}
                  />
                  <span style={{ fontWeight: 900, color: "#0f172a" }}>Mostrar só marcados</span>
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={styles.btnSm} onClick={copyYesterdayActive} disabled={saving || cancelling}>
                  Copiar ontem
                </button>
                <button type="button" style={styles.btnSm} onClick={restoreSavedActive} disabled={saving || cancelling}>
                  Restaurar salvo
                </button>
                <button type="button" style={styles.btnSm} onClick={clearActiveLocal} disabled={saving || cancelling}>
                  Limpar
                </button>
              </div>
            </div>

            {/* LISTA */}
            <div style={{ gridColumn: "span 12" }}>
              {loadingEmployees ? (
                <div style={styles.hint}>Carregando funcionários...</div>
              ) : null}

              <div style={{ display: "grid", gap: 10, paddingBottom: bottomPadding }}>
                {filteredEmployees.map((e) => {
                  const state = employeeState(e.id);
                  const lunchOn = setHas(selLunch, e.id);
                  const dinnerOn = setHas(selDinner, e.id);

                  // quando está em ALMOCO, o card reflete mais o almoço; quando em JANTA, reflete mais a janta
                  const highlight =
                    shift === "ALMOCO"
                      ? lunchOn
                        ? "lunch"
                        : dinnerOn
                        ? "dinner"
                        : "none"
                      : shift === "JANTA"
                      ? dinnerOn
                        ? "dinner"
                        : lunchOn
                        ? "lunch"
                        : "none"
                      : state;

                  return (
                    <div key={e.id} style={styles.employeeCard(highlight as any)}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {e.name}
                          </div>
                          {e.favorite ? (
                            <span
                              style={{
                                borderRadius: 999,
                                padding: "4px 10px",
                                border: "1px solid #fed7aa",
                                background: "#fff7ed",
                                color: "#9a3412",
                                fontWeight: 900,
                                fontSize: 12,
                                whiteSpace: "nowrap",
                              }}
                            >
                              favorito
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <button
                          type="button"
                          style={styles.chip(lunchOn, "lunch")}
                          onClick={() => toggleEmployee(e.id, "ALMOCO")}
                        >
                          {lunchOn ? "✓ Almoço" : "+ Almoço"}
                        </button>

                        <button
                          type="button"
                          style={styles.chip(dinnerOn, "dinner")}
                          onClick={() => toggleEmployee(e.id, "JANTA")}
                        >
                          {dinnerOn ? "✓ Janta" : "+ Janta"}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {!filteredEmployees.length ? (
                  <div style={{ ...styles.hint, padding: 10 }}>Nenhum funcionário para mostrar.</div>
                ) : null}
              </div>
            </div>
          </div>

          {/* FOOTER “APP-LIKE” (STICKY) */}
          <div
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 20,
              marginTop: 10,
              paddingTop: 12,
              background: "linear-gradient(180deg, rgba(255,255,255,0.0), rgba(255,255,255,0.85) 30%, rgba(255,255,255,1))",
              borderRadius: 18,
            }}
          >
            <div
              style={{
                borderRadius: 18,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                padding: 12,
                boxShadow: "0 14px 30px rgba(15, 23, 42, 0.10)",
              }}
            >
              <div style={{ ...styles.label, marginBottom: 8 }}>Totais a salvar (confira antes de pedir)</div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                  <div style={{ fontWeight: 900, letterSpacing: "0.06em", color: "#166534", fontSize: 12 }}>ALMOÇO</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{selectedLunchCount}</div>
                  <div style={{ fontSize: 12, color: "#166534", marginTop: 4 }}>
                    salvo: <b>{savedLunchCount}</b> • limite {limits.lunch}
                  </div>
                </div>

                <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                  <div style={{ fontWeight: 900, letterSpacing: "0.06em", color: "#1d4ed8", fontSize: 12 }}>JANTA</div>
                  <div style={{ fontSize: 32, fontWeight: 900, color: "#0f172a", lineHeight: 1.1 }}>{selectedDinnerCount}</div>
                  <div style={{ fontSize: 12, color: "#1d4ed8", marginTop: 4 }}>
                    salvo: <b>{savedDinnerCount}</b> • limite {limits.dinner}
                  </div>
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  style={styles.bigPrimary(shift === "ALMOCO" ? "lunch" : "dinner")}
                  onClick={saveActive}
                  disabled={saving || cancelling || !worksiteId}
                >
                  {shift === "ALMOCO" ? `Salvar Almoço (${selectedLunchCount})` : `Salvar Janta (${selectedDinnerCount})`}
                </button>

                <button
                  type="button"
                  style={styles.bigDanger}
                  onClick={cancelActive}
                  disabled={saving || cancelling || !worksiteId}
                >
                  {cancelling ? "Cancelando..." : shift === "ALMOCO" ? "Cancelar Almoço" : "Cancelar Janta"}
                </button>

                <button type="button" style={styles.bigGhost} onClick={copySummary} disabled={!worksiteId}>
                  Copiar resumo
                </button>

                <div style={styles.hint}>
                  Cancelar apaga as linhas do pedido (você vai ver no audit como <b>DELETE/INSERT</b>). O pedido em si pode ficar como rascunho.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* só pra garantir que o sticky não “coma” o final */}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

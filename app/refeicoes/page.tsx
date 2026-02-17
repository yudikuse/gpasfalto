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

function fmtBR(iso: string) {
  // iso yyyy-mm-dd
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
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

      if (!selectedWorksiteId && ws.length > 0) setSelectedWorksiteId(ws[0].id);

      setBusy(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  // garante que todo funcionário tenha chave no picks (evita “sumir” seleção)
  useEffect(() => {
    if (!employees.length) return;
    setPicks((prev) => {
      let changed = false;
      const next: Record<string, Pick> = { ...prev };
      for (const e of employees) {
        if (!next[e.id]) {
          next[e.id] = { ALMOCO: false, JANTA: false };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [employees]);

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

      // contrato (mais recente com start_date <= data)
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
        setPicks((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) next[k] = { ALMOCO: false, JANTA: false };
          return next;
        });
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

        for (const e of employees) map[e.id] = { ALMOCO: false, JANTA: false };

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
  }, [sessionUserId, selectedWorksiteId, dateISO, employees]);

  const worksiteLabel = useMemo(() => {
    const w = worksites.find((x) => x.id === selectedWorksiteId);
    if (!w) return "";
    return `${w.name}${w.city ? ` - ${w.city}` : ""}`;
  }, [worksites, selectedWorksiteId]);

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
    setToast("Copiado do dia anterior ✅");
  }

  async function copyWhatsappSummary() {
    const almocoNames: string[] = [];
    const jantaNames: string[] = [];

    for (const e of employeesOrdered) {
      const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
      if (p.ALMOCO) almocoNames.push(e.full_name);
      if (p.JANTA) jantaNames.push(e.full_name);
    }

    const lines: string[] = [];
    lines.push(`Refeições • ${worksiteLabel || "Obra"} • ${fmtBR(dateISO)}`);
    lines.push(`Almoço: ${totals.almoco} | Janta: ${totals.janta}`);

    if (contract) {
      lines.push(
        `Horário limite: Almoço ${contract.cutoff_lunch ?? "--"} | Janta ${contract.cutoff_dinner ?? "--"}`
      );
    }

    lines.push("");
    lines.push("ALMOÇO:");
    if (almocoNames.length) almocoNames.forEach((n) => lines.push(`- ${n}`));
    else lines.push("- (nenhum)");

    lines.push("");
    lines.push("JANTA:");
    if (jantaNames.length) jantaNames.forEach((n) => lines.push(`- ${n}`));
    else lines.push("- (nenhum)");

    const txt = lines.join("\n");

    try {
      await navigator.clipboard.writeText(txt);
      setToast("Resumo copiado ✅ (cole no WhatsApp)");
    } catch {
      setToast("Não consegui copiar automaticamente. Tente em outro navegador/dispositivo.");
    }
  }

  async function save() {
    if (!selectedWorksiteId) return;
    if (!contract) {
      setToast("Sem contrato para salvar.");
      return;
    }

    const lateLunch = nowAfterCutoff(contract.cutoff_lunch);
    const lateDinner = nowAfterCutoff(contract.cutoff_dinner);
    if ((lateLunch || lateDinner) && contract.allow_after_cutoff === false) {
      setToast("Atenção: passou do horário limite e esse contrato não permite após o limite.");
      // não bloqueia nesta 1ª versão
    }

    setBusy("Salvando...");
    setToast(null);

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
        .update({ restaurant_id: contract.restaurant_id })
        .eq("id", orderId);

      if (upd.error) {
        setBusy(null);
        setToast(`Erro atualizar pedido: ${upd.error.message}`);
        return;
      }
    }

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

  // ===== UI =====

  if (!sessionUserId) {
    return (
      <div className="page-root">
        <div className="page-container">
          <div className="section-card">
            <div className="page-header">
              <div className="brand">
                <div
                  className="brand-logo"
                  style={{
                    display: "grid",
                    placeItems: "center",
                    fontWeight: 700,
                    color: "var(--gp-accent)",
                  }}
                >
                  GP
                </div>
                <div>
                  <div className="brand-text-main">Refeições</div>
                  <div className="brand-text-sub">Acesso por link no e-mail</div>
                </div>
              </div>
            </div>

            <div className="gp-divider" />

            <div className="gp-help" style={{ marginBottom: 10 }}>
              Digite o e-mail e enviaremos um link de acesso (sem senha).
            </div>

            <div className="gp-inline">
              <div style={{ flex: 1, minWidth: 240 }}>
                <div className="filter-label">E-mail</div>
                <input
                  className="gp-input"
                  placeholder="seuemail@empresa.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  inputMode="email"
                  autoComplete="email"
                />
              </div>

              <button className="gp-btn gp-btn-primary" onClick={sendMagicLink} disabled={!loginEmail.trim() || !!busy}>
                {busy ? busy : "Enviar link"}
              </button>
            </div>

            {loginSent && (
              <div className="gp-help" style={{ marginTop: 10 }}>
                Link enviado ✅ Abra seu e-mail e clique para entrar.
              </div>
            )}

            {toast && (
              <div className="state-card" style={{ marginTop: 12 }}>
                {toast}
              </div>
            )}
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
            <div
              className="brand-logo"
              style={{
                display: "grid",
                placeItems: "center",
                fontWeight: 700,
                color: "var(--gp-accent)",
              }}
            >
              GP
            </div>
            <div>
              <div className="brand-text-main">Refeições</div>
              <div className="brand-text-sub">Controle por obra • pronto pra produção</div>
            </div>
          </div>

          <div className="header-right">
            <div className="header-pill">
              <span style={{ opacity: 0.8 }}>Logado:</span>{" "}
              <b>{userEmail || sessionUserId}</b>
            </div>

            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              {busy && <span className="gp-badge">{busy}</span>}
              <button className="gp-btn gp-btn-ghost" onClick={logout}>
                Sair
              </button>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <div style={{ minWidth: 260, flex: 1 }}>
            <div className="filter-label">Obra</div>
            <select
              className="gp-select"
              value={selectedWorksiteId}
              onChange={(e) => setSelectedWorksiteId(e.target.value)}
              disabled={!!busy}
            >
              {worksites.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} {w.city ? `- ${w.city}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 170 }}>
            <div className="filter-label">Data</div>
            <input
              type="date"
              className="gp-input"
              value={dateISO}
              onChange={(e) => setDateISO(e.target.value)}
              disabled={!!busy}
            />
          </div>

          <div style={{ minWidth: 220 }}>
            <div className="filter-label">Buscar</div>
            <input
              className="gp-input"
              placeholder="Nome do funcionário..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!!busy}
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
            <div className="summary-value" style={{ fontSize: "1.25rem" }}>
              {contract ? `${contract.cutoff_lunch ?? "--"} / ${contract.cutoff_dinner ?? "--"}` : "-- / --"}
            </div>
            <div className="summary-subvalue">Almoço / Janta</div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Ações rápidas</div>
            <div className="gp-actions">
              <button className="gp-btn" onClick={copyYesterday} disabled={!!busy || !selectedWorksiteId}>
                Copiar ontem
              </button>
              <button className="gp-btn gp-btn-ghost" onClick={copyWhatsappSummary} disabled={!!busy}>
                Copiar resumo WhatsApp
              </button>
            </div>
            <div className="summary-subvalue" style={{ marginTop: 8 }}>
              Obra: <b>{worksiteLabel || "--"}</b> • {fmtBR(dateISO)}
            </div>
          </div>
        </div>

        {toast && <div className="state-card">{toast}</div>}

        <div className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Marcação</div>
              <div className="section-subtitle">
                Marque almoço/janta por funcionário e clique em <b>Salvar</b>.
              </div>
            </div>

            <div className="gp-actions">
              <button className="gp-btn" onClick={() => setAll("ALMOCO", true)} disabled={!!busy}>
                Todos almoço
              </button>
              <button className="gp-btn" onClick={() => setAll("JANTA", true)} disabled={!!busy}>
                Todos janta
              </button>
              <button className="gp-btn gp-btn-danger" onClick={clearAll} disabled={!!busy}>
                Limpar
              </button>
              <button className="gp-btn gp-btn-primary" onClick={save} disabled={!!busy || !selectedWorksiteId}>
                {busy ? busy : "Salvar"}
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th style={{ width: 120 }}>Almoço</th>
                  <th style={{ width: 120 }}>Janta</th>
                </tr>
              </thead>
              <tbody>
                {employeesOrdered.map((e) => {
                  const p = picks[e.id] ?? { ALMOCO: false, JANTA: false };
                  const isFav = favoritesIds.has(e.id);

                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600 }}>{e.full_name}</span>{" "}
                        {isFav && <span className="gp-badge gp-badge-strong">favorito</span>}
                      </td>

                      <td>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
                          <span>Sim</span>
                        </label>
                      </td>

                      <td>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
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
                          <span>Sim</span>
                        </label>
                      </td>
                    </tr>
                  );
                })}

                {employeesOrdered.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 18, color: "var(--gp-muted)" }}>
                      Nenhum funcionário encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {contract && (
            <div className="gp-help" style={{ marginTop: 12 }}>
              Observação: passou do horário?{" "}
              <b>{contract.allow_after_cutoff === false ? "Contrato NÃO permite após o limite." : "Contrato permite após o limite."}</b>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

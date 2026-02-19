// FILE: app/refeicoes/restaurante/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

type Worksite = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type OrderLine = {
  id: string;
  included: boolean | null;
};

type OrderRow = {
  id: string;
  worksite_id: string;
  meal_date: string; // YYYY-MM-DD
  shift: Shift;
  status: string | null;
  cutoff_at: string | null; // timestamptz
  submitted_at: string | null;
  confirmed_at: string | null;
  closed_at: string | null;
  meal_order_lines?: OrderLine[];
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

function timeHHMMFromISODateTime(iso: string | null) {
  if (!iso) return "--:--";
  const dt = new Date(iso);
  return `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function isSameISODate(a: string, b: string) {
  return a === b;
}

function pillStyle(kind: "neutral" | "ok" | "warn" | "bad"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#0f172a",
    whiteSpace: "nowrap",
  };
  if (kind === "ok") return { ...base, borderColor: "#86efac", background: "#ecfdf5", color: "#166534" };
  if (kind === "warn") return { ...base, borderColor: "#fde68a", background: "#fffbeb", color: "#92400e" };
  if (kind === "bad") return { ...base, borderColor: "#fecaca", background: "#fef2f2", color: "#991b1b" };
  return { ...base, borderColor: "#e2e8f0", background: "#f8fafc", color: "#0f172a" };
}

function btnStyle(kind: "primary" | "ghost", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 14,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    border: "1px solid transparent",
    width: "100%",
  };
  if (kind === "primary") {
    return { ...base, background: "#2563eb", borderColor: "#1d4ed8", color: "#fff" };
  }
  return { ...base, background: "#fff", borderColor: "#e5e7eb", color: "#0f172a" };
}

function normalizeStatus(s: string | null) {
  const v = String(s || "").trim().toUpperCase();
  return v || "DRAFT";
}

function statusLabel(status: string | null) {
  const s = normalizeStatus(status);
  if (s === "CONFIRMED") return { text: "CONFIRMADO", kind: "ok" as const };
  if (s === "CLOSED") return { text: "FECHADO", kind: "neutral" as const };
  if (s === "SUBMITTED") return { text: "ENVIADO", kind: "warn" as const };
  if (s === "DRAFT") return { text: "RASCUNHO", kind: "warn" as const };
  return { text: s, kind: "neutral" as const };
}

export default function RefeicoesRestaurantePage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState("");
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());
  const [worksites, setWorksites] = useState<Worksite[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function handleSignOut() {
    await supabase.auth.signOut();
    // volta pro módulo de refeições (não pro "/")
    router.push("/refeicoes");
  }

  const wsMap = useMemo(() => {
    const m = new Map<string, Worksite>();
    for (const w of worksites) m.set(w.id, w);
    return m;
  }, [worksites]);

  const ordersLunch = useMemo(() => orders.filter((o) => o.shift === "ALMOCO"), [orders]);
  const ordersDinner = useMemo(() => orders.filter((o) => o.shift === "JANTA"), [orders]);

  const totals = useMemo(() => {
    const countIncluded = (o: OrderRow) => (o.meal_order_lines || []).filter((l) => l.included).length;
    const lunch = ordersLunch.reduce((acc, o) => acc + countIncluded(o), 0);
    const dinner = ordersDinner.reduce((acc, o) => acc + countIncluded(o), 0);
    return { lunch, dinner, all: lunch + dinner };
  }, [ordersLunch, ordersDinner]);

  function worksiteLabel(id: string) {
    const w = wsMap.get(id);
    if (!w) return id;
    return `${w.name}${w.city ? ` - ${w.city}` : ""}`;
  }

  function countIncluded(o: OrderRow) {
    return (o.meal_order_lines || []).filter((l) => l.included).length;
  }

  function canConfirm(o: OrderRow) {
    // regra: só confirmar depois do cutoff (se for hoje e tiver cutoff_at)
    if (!o.cutoff_at) return true;
    if (!isSameISODate(mealDate, isoTodayLocal())) return true;
    const now = new Date();
    const cutoff = new Date(o.cutoff_at);
    return now.getTime() >= cutoff.getTime();
  }

  async function loadAll(dateISO: string) {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      // user
      const { data: ud, error: ue } = await supabase.auth.getUser();
      if (ue) throw ue;
      const u = ud?.user;
      if (!u) {
        setError("Faça login para acessar o portal do restaurante.");
        setRestaurantId(null);
        setOrders([]);
        return;
      }
      setUserEmail(u.email || "");

      // restaurant binding
      const { data: ru, error: re } = await supabase
        .from("meal_restaurant_users")
        .select("restaurant_id")
        .eq("user_id", u.id)
        .maybeSingle();

      if (re) throw re;
      const rid = (ru as any)?.restaurant_id ? String((ru as any).restaurant_id) : null;
      if (!rid) {
        setError("Seu usuário não está vinculado a nenhum restaurante (meal_restaurant_users).");
        setRestaurantId(null);
        setOrders([]);
        return;
      }
      setRestaurantId(rid);

      // worksites (pra mostrar o nome)
      const wsRes = await supabase.from("meal_worksites").select("id,name,city,active").eq("active", true).order("name");
      if (wsRes.error) throw wsRes.error;
      setWorksites((wsRes.data || []) as Worksite[]);

      // orders + lines do dia (só quantidade; não mostramos nomes)
      const ordRes = await supabase
        .from("meal_orders")
        .select("id,worksite_id,meal_date,shift,status,cutoff_at,submitted_at,confirmed_at,closed_at,meal_order_lines(id,included)")
        .eq("restaurant_id", rid)
        .eq("meal_date", dateISO);

      if (ordRes.error) throw ordRes.error;

      const rows = (ordRes.data || []) as any as OrderRow[];

      // ordena por obra (nome) e depois turno
      rows.sort((a, b) => {
        const an = worksiteLabel(a.worksite_id);
        const bn = worksiteLabel(b.worksite_id);
        const c = an.localeCompare(bn, "pt-BR");
        if (c !== 0) return c;
        return a.shift.localeCompare(b.shift);
      });

      setOrders(rows);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar portal do restaurante.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll(mealDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mealDate]);

  async function confirmOrder(orderId: string) {
    setError(null);
    setOkMsg(null);

    setActing((p) => ({ ...p, [orderId]: true }));
    try {
      const { data: ud } = await supabase.auth.getUser();
      const userId = ud?.user?.id ?? null;
      if (!userId) throw new Error("Sessão expirada. Faça login novamente.");

      const nowISO = new Date().toISOString();

      // tenta atualizar status + confirmed_at
      let up = await supabase
        .from("meal_orders")
        .update({ status: "CONFIRMED", confirmed_at: nowISO, updated_by: userId })
        .eq("id", orderId);

      // fallback: se seu enum não tiver CONFIRMED, pelo menos grava confirmed_at
      if (up.error && String(up.error.message || "").includes("invalid input value for enum")) {
        up = await supabase.from("meal_orders").update({ confirmed_at: nowISO, updated_by: userId }).eq("id", orderId);
      }

      if (up.error) throw up.error;

      await loadAll(mealDate);
      setOkMsg("Confirmado com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro ao confirmar.");
    } finally {
      setActing((p) => ({ ...p, [orderId]: false }));
    }
  }

  async function copyResumoRestaurante() {
    // resumo só com quantidades por obra/turno
    const byShift = (shift: Shift) => orders.filter((o) => o.shift === shift);

    const lines = (shift: Shift) =>
      byShift(shift)
        .map((o) => `- ${worksiteLabel(o.worksite_id)}: ${countIncluded(o)}`)
        .join("\n") || "-";

    const msg =
      `🍽️ PEDIDOS DO DIA (Restaurante)\n` +
      `📅 Data: ${formatBRFromISO(mealDate)}\n\n` +
      `ALMOÇO (total ${totals.lunch})\n${lines("ALMOCO")}\n\n` +
      `JANTA (total ${totals.dinner})\n${lines("JANTA")}`;

    try {
      await navigator.clipboard.writeText(msg);
      setOkMsg("Resumo copiado.");
    } catch {
      setError("Não consegui copiar automaticamente (permita clipboard).");
    }
  }

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 40 }}>
        <header
          className="page-header"
          style={{
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 40, height: 40, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div>
              <div className="brand-text-main" style={{ lineHeight: 1.1 }}>
                Restaurante
              </div>
              <div className="brand-text-sub" style={{ opacity: 0.85 }}>
                Totais do dia • Confirmar
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>

            <button
              type="button"
              onClick={handleSignOut}
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Sair
            </button>
          </div>
        </header>

        <div className="section-card">
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

          {okMsg ? (
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
              {okMsg}
            </div>
          ) : null}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 6" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Data
              </div>
              <input
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                style={{
                  width: "100%",
                  marginTop: 6,
                  borderRadius: 14,
                  border: "1px solid #e5e7eb",
                  padding: "12px 12px",
                  fontSize: 16,
                  outline: "none",
                  background: "#fff",
                }}
                disabled={loading}
              />
            </div>

            <div style={{ gridColumn: "span 6", display: "flex", alignItems: "flex-end", gap: 10 }}>
              <button type="button" style={btnStyle("ghost", loading)} onClick={() => loadAll(mealDate)} disabled={loading}>
                Atualizar
              </button>
              <button type="button" style={btnStyle("ghost", loading)} onClick={copyResumoRestaurante} disabled={loading}>
                Copiar resumo
              </button>
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 6 }}>
              <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
                <div style={{ fontSize: 28, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.lunch}</div>
              </div>
              <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
                <div style={{ fontSize: 28, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.dinner}</div>
              </div>
            </div>
          </div>
        </div>

        {/* ALMOÇO */}
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Almoço</div>
              <div className="section-subtitle">Somente quantidades por obra. Confirmar após o cutoff.</div>
            </div>
            <div style={pillStyle("neutral")}>{formatBRFromISO(mealDate)}</div>
          </div>

          {ordersLunch.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Nenhum pedido de almoço para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {ordersLunch.map((o) => {
                const st = statusLabel(o.status);
                const qty = countIncluded(o);
                const cutoff = timeHHMMFromISODateTime(o.cutoff_at);
                const allow = canConfirm(o);
                const isConfirmed = normalizeStatus(o.status) === "CONFIRMED" || Boolean(o.confirmed_at);

                return (
                  <div key={o.id} style={{ borderRadius: 16, border: "1px solid #eef2f7", background: "#fff", padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                        {worksiteLabel(o.worksite_id)}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={pillStyle("neutral")}>Qtd: {qty}</div>
                        <div style={pillStyle("neutral")}>Cutoff: {cutoff}</div>
                        <div style={pillStyle(st.kind)}>{st.text}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        style={btnStyle("primary", !allow || acting[o.id] || isConfirmed || qty === 0)}
                        disabled={!allow || acting[o.id] || isConfirmed || qty === 0}
                        onClick={() => confirmOrder(o.id)}
                        title={!allow ? "Aguardando cutoff" : isConfirmed ? "Já confirmado" : ""}
                      >
                        {acting[o.id] ? "Confirmando..." : isConfirmed ? "Confirmado" : "Confirmar"}
                      </button>

                      {!allow ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>
                          Aguardando cutoff para confirmar.
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* JANTA */}
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Janta</div>
              <div className="section-subtitle">Somente quantidades por obra. Confirmar após o cutoff.</div>
            </div>
            <div style={pillStyle("neutral")}>{formatBRFromISO(mealDate)}</div>
          </div>

          {ordersDinner.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Nenhum pedido de janta para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {ordersDinner.map((o) => {
                const st = statusLabel(o.status);
                const qty = countIncluded(o);
                const cutoff = timeHHMMFromISODateTime(o.cutoff_at);
                const allow = canConfirm(o);
                const isConfirmed = normalizeStatus(o.status) === "CONFIRMED" || Boolean(o.confirmed_at);

                return (
                  <div key={o.id} style={{ borderRadius: 16, border: "1px solid #eef2f7", background: "#fff", padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 14, fontWeight: 950, color: "#0f172a", textTransform: "uppercase", letterSpacing: "0.02em" }}>
                        {worksiteLabel(o.worksite_id)}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <div style={pillStyle("neutral")}>Qtd: {qty}</div>
                        <div style={pillStyle("neutral")}>Cutoff: {cutoff}</div>
                        <div style={pillStyle(st.kind)}>{st.text}</div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        style={btnStyle("primary", !allow || acting[o.id] || isConfirmed || qty === 0)}
                        disabled={!allow || acting[o.id] || isConfirmed || qty === 0}
                        onClick={() => confirmOrder(o.id)}
                        title={!allow ? "Aguardando cutoff" : isConfirmed ? "Já confirmado" : ""}
                      >
                        {acting[o.id] ? "Confirmando..." : isConfirmed ? "Confirmado" : "Confirmar"}
                      </button>

                      {!allow ? (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>
                          Aguardando cutoff para confirmar.
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {loading ? <div style={{ marginTop: 12, fontSize: 13, color: "var(--gp-muted-soft)" }}>Carregando…</div> : null}

        <div style={{ marginTop: 14, fontSize: 12, color: "var(--gp-muted-soft)" }}>
          * Este portal não mostra nomes (só quantidades). A empresa mantém os detalhes e o audit.
        </div>
      </div>
    </div>
  );
}

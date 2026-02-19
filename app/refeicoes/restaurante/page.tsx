// FILE: app/refeicoes/restaurante/page.tsx
"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

type Restaurant = {
  id: string;
  name: string;
  city: string | null;
  active: boolean | null;
};

type Worksite = {
  id: string;
  name: string;
  city: string | null;
};

type OrderRow = {
  id: string;
  worksite_id: string;
  shift: Shift;
  status: string | null;
  cutoff_at: string | null; // timestamptz
  confirmed_at: string | null; // timestamptz
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

function timeHHMMFromISO(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function cardTitleStyle(color: string): CSSProperties {
  return {
    fontSize: 12,
    fontWeight: 900,
    color,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  };
}

function bigBtnStyle(kind: "primary" | "ghost", disabled?: boolean): CSSProperties {
  const base: CSSProperties = {
    width: "100%",
    borderRadius: 14,
    padding: "14px 14px",
    fontSize: 16,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    border: "1px solid transparent",
    background: "#fff",
    color: "#0f172a",
  };

  if (kind === "primary") {
    return {
      ...base,
      background: "#2563eb",
      color: "#fff",
      borderColor: "#1d4ed8",
      boxShadow: "0 12px 26px rgba(37, 99, 235, 0.18)",
    };
  }

  return {
    ...base,
    borderColor: "#e5e7eb",
  };
}

export default function RestaurantePage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");

  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [worksitesById, setWorksitesById] = useState<Record<string, Worksite>>({});
  const [qtyByOrderId, setQtyByOrderId] = useState<Record<string, number>>({});

  async function handleSignOut() {
    await supabase.auth.signOut();
    // mantém no módulo de refeições (e o middleware/login decide o resto)
    router.push("/refeicoes");
  }

  async function loadContext() {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      const { data: ud } = await supabase.auth.getUser();
      const u = ud?.user;
      setUserEmail(u?.email || "");
      setUserId(u?.id || null);

      if (!u?.id) {
        setError("Você não está logado.");
        return;
      }

      // vínculos do usuário com restaurantes
      const linkRes = await supabase
        .from("meal_restaurant_users")
        .select("restaurant_id")
        .eq("user_id", u.id);

      if (linkRes.error) throw linkRes.error;

      const ids = (linkRes.data || []).map((r: any) => String(r.restaurant_id)).filter(Boolean);

      if (!ids.length) {
        setRestaurants([]);
        setRestaurantId("");
        setError("Seu usuário não está vinculado a nenhum restaurante (meal_restaurant_users).");
        return;
      }

      const restRes = await supabase
        .from("meal_restaurants")
        .select("id,name,city,active")
        .in("id", ids)
        .eq("active", true)
        .order("name", { ascending: true });

      if (restRes.error) throw restRes.error;

      const rows = (restRes.data || []) as Restaurant[];
      setRestaurants(rows);

      if (!restaurantId && rows[0]?.id) setRestaurantId(rows[0].id);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  async function loadDay() {
    setLoading(true);
    setError(null);
    setOkMsg(null);

    try {
      if (!restaurantId) return;

      const oRes = await supabase
        .from("meal_orders")
        .select("id,worksite_id,shift,status,cutoff_at,confirmed_at,created_at")
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate)
        .in("shift", ["ALMOCO", "JANTA"])
        .order("created_at", { ascending: true });

      if (oRes.error) throw oRes.error;

      const o = (oRes.data || []) as any[];
      const parsed: OrderRow[] = o.map((r) => ({
        id: String(r.id),
        worksite_id: String(r.worksite_id),
        shift: r.shift as Shift,
        status: r.status ?? null,
        cutoff_at: r.cutoff_at ?? null,
        confirmed_at: r.confirmed_at ?? null,
      }));
      setOrders(parsed);

      const orderIds = parsed.map((x) => x.id);
      const wsIds = Array.from(new Set(parsed.map((x) => x.worksite_id)));

      // worksites
      if (wsIds.length) {
        const wsRes = await supabase.from("meal_worksites").select("id,name,city").in("id", wsIds);
        if (wsRes.error) throw wsRes.error;

        const map: Record<string, Worksite> = {};
        for (const w of (wsRes.data || []) as any[]) {
          map[String(w.id)] = { id: String(w.id), name: String(w.name), city: w.city ?? null };
        }
        setWorksitesById(map);
      } else {
        setWorksitesById({});
      }

      // linhas -> quantidades (included=true)
      if (orderIds.length) {
        const lRes = await supabase
          .from("meal_order_lines")
          .select("meal_order_id")
          .in("meal_order_id", orderIds)
          .eq("included", true);

        if (lRes.error) throw lRes.error;

        const counts: Record<string, number> = {};
        for (const row of (lRes.data || []) as any[]) {
          const oid = String(row.meal_order_id);
          counts[oid] = (counts[oid] || 0) + 1;
        }
        setQtyByOrderId(counts);
      } else {
        setQtyByOrderId({});
      }
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar pedidos do dia.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    loadDay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, mealDate]);

  const byShift = useMemo(() => {
    const mk = (shift: Shift) => {
      const list = orders.filter((o) => o.shift === shift);

      const items = list
        .map((o) => {
          const ws = worksitesById[o.worksite_id];
          const wsName = ws ? `${ws.name}${ws.city ? " - " + ws.city : ""}` : o.worksite_id;
          return {
            orderId: o.id,
            worksiteName: wsName,
            qty: qtyByOrderId[o.id] || 0,
            cutoffAt: o.cutoff_at,
            status: o.status,
            confirmedAt: o.confirmed_at,
          };
        })
        .sort((a, b) => a.worksiteName.localeCompare(b.worksiteName, "pt-BR"));

      const total = items.reduce((acc, it) => acc + it.qty, 0);

      const maxCutoff = items
        .map((it) => (it.cutoffAt ? new Date(it.cutoffAt).getTime() : null))
        .filter((x): x is number => typeof x === "number")
        .reduce<number | null>((acc, t) => (acc === null ? t : Math.max(acc, t)), null);

      const allConfirmed = items.length > 0 && items.every((it) => Boolean(it.confirmedAt) || it.status === "CONFIRMED");

      return { items, total, maxCutoff, allConfirmed };
    };

    return { ALMOCO: mk("ALMOCO"), JANTA: mk("JANTA") };
  }, [orders, worksitesById, qtyByOrderId]);

  const canConfirm = useMemo(() => {
    const today = isoTodayLocal();
    const now = Date.now();

    const rules = (shift: Shift) => {
      const pack = byShift[shift];
      if (!pack.items.length) return { disabled: true, reason: "Sem pedidos." };
      if (pack.allConfirmed) return { disabled: true, reason: "Já confirmado." };
      if (!pack.maxCutoff) return { disabled: true, reason: "Sem horário de cutoff." };
      if (mealDate > today) return { disabled: true, reason: "Data futura." };
      if (mealDate === today && now < pack.maxCutoff) {
        return { disabled: true, reason: `Aguarde cutoff (${timeHHMMFromISO(new Date(pack.maxCutoff).toISOString())}).` };
      }
      return { disabled: false, reason: "" };
    };

    return { ALMOCO: rules("ALMOCO"), JANTA: rules("JANTA") };
  }, [byShift, mealDate]);

  async function confirmShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!restaurantId) return;
    if (!userId) return setError("Você não está logado."), undefined;

    const ids = byShift[shift].items.map((it) => it.orderId);
    if (!ids.length) return;

    setConfirming((p) => ({ ...p, [shift]: true }));

    try {
      const nowISO = new Date().toISOString();

      // tenta setar status + confirmed_at
      const up1 = await supabase
        .from("meal_orders")
        .update({
          status: "CONFIRMED",
          confirmed_at: nowISO,
          updated_by: userId,
        })
        .in("id", ids);

      if (up1.error) {
        // fallback: se o enum/status der problema, confirma só pelo timestamp
        const up2 = await supabase
          .from("meal_orders")
          .update({
            confirmed_at: nowISO,
            updated_by: userId,
          })
          .in("id", ids);

        if (up2.error) throw up2.error;
      }

      await loadDay();
      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} confirmado.`);
    } catch (e: any) {
      setError(e?.message || "Erro ao confirmar.");
    } finally {
      setConfirming((p) => ({ ...p, [shift]: false }));
    }
  }

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 40 }}>
        <header
          className="page-header"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div />

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 44, height: 44, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div className="brand-text-main" style={{ lineHeight: 1.1 }}>
              Restaurante
            </div>
          </div>

          <div style={{ justifySelf: "end", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <div style={{ fontSize: 11, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            <div style={{ gridColumn: "span 12" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Restaurante
              </div>
              <select
                value={restaurantId}
                onChange={(e) => setRestaurantId(e.target.value)}
                disabled={loading || restaurants.length <= 1}
                style={{
                  width: "100%",
                  borderRadius: 14,
                  border: "1px solid #e5e7eb",
                  padding: "12px 12px",
                  fontSize: 16,
                  outline: "none",
                  background: "#ffffff",
                  color: "var(--gp-text)",
                }}
              >
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.city ? ` - ${r.city}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Data
              </div>
              <input
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                disabled={loading}
                style={{
                  width: "100%",
                  borderRadius: 14,
                  border: "1px solid #e5e7eb",
                  padding: "12px 12px",
                  fontSize: 16,
                  outline: "none",
                  background: "#ffffff",
                  color: "var(--gp-text)",
                }}
              />
            </div>

            <div style={{ gridColumn: "span 6", display: "flex", alignItems: "flex-end", gap: 10 }}>
              <button type="button" onClick={loadDay} disabled={loading || !restaurantId} style={bigBtnStyle("ghost", loading || !restaurantId)}>
                {loading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                <div style={cardTitleStyle("#166534")}>Almoço</div>
                <div style={{ fontSize: 28, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{byShift.ALMOCO.total}</div>
                <div style={{ fontSize: 12, color: "#166534" }}>
                  cutoff: {timeHHMMFromISO(byShift.ALMOCO.maxCutoff ? new Date(byShift.ALMOCO.maxCutoff).toISOString() : null)}
                </div>
              </div>

              <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={cardTitleStyle("#1d4ed8")}>Janta</div>
                <div style={{ fontSize: 28, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{byShift.JANTA.total}</div>
                <div style={{ fontSize: 12, color: "#1d4ed8" }}>
                  cutoff: {timeHHMMFromISO(byShift.JANTA.maxCutoff ? new Date(byShift.JANTA.maxCutoff).toISOString() : null)}
                </div>
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
            <div
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 900,
              }}
            >
              {formatBRFromISO(mealDate)}
            </div>
          </div>

          {byShift.ALMOCO.items.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {byShift.ALMOCO.items.map((it) => (
                <div
                  key={it.orderId}
                  style={{
                    borderRadius: 14,
                    border: "1px solid #eef2f7",
                    background: "#fff",
                    padding: "10px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{it.worksiteName}</div>
                  <div style={{ fontWeight: 950, fontSize: 18, color: "#166534" }}>{it.qty}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Nenhum pedido de almoço para este dia.</div>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => confirmShift("ALMOCO")}
              disabled={confirming.ALMOCO || canConfirm.ALMOCO.disabled}
              style={bigBtnStyle("primary", confirming.ALMOCO || canConfirm.ALMOCO.disabled)}
              title={canConfirm.ALMOCO.reason || ""}
            >
              {byShift.ALMOCO.allConfirmed ? "Almoço confirmado" : confirming.ALMOCO ? "Confirmando..." : "Confirmar Almoço"}
            </button>
            {canConfirm.ALMOCO.disabled && !byShift.ALMOCO.allConfirmed ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>{canConfirm.ALMOCO.reason}</div>
            ) : null}
          </div>
        </div>

        {/* JANTA */}
        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Janta</div>
              <div className="section-subtitle">Somente quantidades por obra. Confirmar após o cutoff.</div>
            </div>
            <div
              style={{
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#fff",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 900,
              }}
            >
              {formatBRFromISO(mealDate)}
            </div>
          </div>

          {byShift.JANTA.items.length ? (
            <div style={{ display: "grid", gap: 8 }}>
              {byShift.JANTA.items.map((it) => (
                <div
                  key={it.orderId}
                  style={{
                    borderRadius: 14,
                    border: "1px solid #eef2f7",
                    background: "#fff",
                    padding: "10px 12px",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 900, color: "#0f172a" }}>{it.worksiteName}</div>
                  <div style={{ fontWeight: 950, fontSize: 18, color: "#1d4ed8" }}>{it.qty}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Nenhum pedido de janta para este dia.</div>
          )}

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => confirmShift("JANTA")}
              disabled={confirming.JANTA || canConfirm.JANTA.disabled}
              style={bigBtnStyle("primary", confirming.JANTA || canConfirm.JANTA.disabled)}
              title={canConfirm.JANTA.reason || ""}
            >
              {byShift.JANTA.allConfirmed ? "Janta confirmada" : confirming.JANTA ? "Confirmando..." : "Confirmar Janta"}
            </button>
            {canConfirm.JANTA.disabled && !byShift.JANTA.allConfirmed ? (
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>{canConfirm.JANTA.reason}</div>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: "var(--gp-muted-soft)", textAlign: "center" }}>
          * Este portal não mostra nomes (só quantidades). A empresa mantém os detalhes e o audit.
        </div>
      </div>
    </div>
  );
}

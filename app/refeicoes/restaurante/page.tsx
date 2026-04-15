"use client";

import { Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Shift = "ALMOCO" | "JANTA";

type Restaurant = {
  id: string;
  name: string;
  city: string | null;
  document: string | null;
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
  confirmed_at: string | null;
};

type ContractRow = {
  cutoff_lunch: string | null;
  cutoff_dinner: string | null;
  start_date: string | null;
  end_date: string | null;
};

const LS_KEY = "meal_restaurant_login_v2";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function onlyDigits(v: string) {
  return (v || "").replace(/\D/g, "");
}

function formatCNPJ(v: string) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function toHHMM(t: string | null) {
  if (!t) return null;
  const parts = String(t).split(":");
  if (parts.length < 2) return null;
  const hh = pad2(Number(parts[0] || 0));
  const mm = pad2(Number(parts[1] || 0));
  return `${hh}:${mm}`;
}

function hhmmFromISO(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function minutesFromHHMM(hhmm: string | null) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function buildCutoffISO_BRT(mealDateISO: string, hhmm: string | null) {
  if (!hhmm) return null;
  return `${mealDateISO}T${hhmm}:00-03:00`;
}

function RestaurantePageFallback() {
  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 48 }}>
        <div className="section-card" style={{ maxWidth: 460, margin: "48px auto 0" }}>
          <div style={{ fontSize: 14, color: "var(--gp-muted-soft)" }}>Carregando...</div>
        </div>
      </div>
    </div>
  );
}

function RestaurantePageInner() {
  const searchParams = useSearchParams();
  const ridFromLink = (searchParams.get("rid") || "").trim();
  const lockedByLink = Boolean(ridFromLink);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [cnpj, setCnpj] = useState("");

  const [loggedRestaurant, setLoggedRestaurant] = useState<Restaurant | null>(null);
  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [loading, setLoading] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [confirming, setConfirming] = useState<Record<Shift, boolean>>({
    ALMOCO: false,
    JANTA: false,
  });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [totals, setTotals] = useState<Record<Shift, number>>({
    ALMOCO: 0,
    JANTA: 0,
  });

  const [byWorksite, setByWorksite] = useState<
    Record<Shift, Array<{ worksite_id: string; worksite_name: string; qty: number }>>
  >({
    ALMOCO: [],
    JANTA: [],
  });

  const [confirmedAll, setConfirmedAll] = useState<Record<Shift, boolean>>({
    ALMOCO: false,
    JANTA: false,
  });

  const [cutoffAtByShift, setCutoffAtByShift] = useState<Record<Shift, string | null>>({
    ALMOCO: null,
    JANTA: null,
  });

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
  };

  async function loadRestaurants() {
    let query = supabase
      .from("meal_restaurants")
      .select("id,name,city,document,active")
      .eq("active", true);

    if (ridFromLink) {
      query = query.eq("id", ridFromLink);
    }

    const { data, error } = await query.order("name", { ascending: true });
    if (error) throw error;

    const list = (data || []) as Restaurant[];
    setRestaurants(list);

    if (list.length > 0) {
      setRestaurantId(list[0].id);
    }

    return list;
  }

  function saveLogin(rest: Restaurant) {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        restaurantId: rest.id,
        document: rest.document || "",
      })
    );
  }

  function clearLogin() {
    localStorage.removeItem(LS_KEY);
    setLoggedRestaurant(null);
    setRestaurantId(restaurants[0]?.id || "");
    setCnpj("");
    setError(null);
    setOkMsg(null);
    setTotals({ ALMOCO: 0, JANTA: 0 });
    setByWorksite({ ALMOCO: [], JANTA: [] });
    setConfirmedAll({ ALMOCO: false, JANTA: false });
    setCutoffAtByShift({ ALMOCO: null, JANTA: null });
  }

  async function tryAutoLogin(listArg?: Restaurant[]) {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as { restaurantId?: string; document?: string };
      if (!parsed?.restaurantId) return;

      const list = listArg || restaurants;
      const found = list.find((r) => r.id === parsed.restaurantId);
      if (!found) {
        localStorage.removeItem(LS_KEY);
        return;
      }

      if (onlyDigits(found.document || "") !== onlyDigits(parsed.document || "")) {
        localStorage.removeItem(LS_KEY);
        return;
      }

      setLoggedRestaurant(found);
      setRestaurantId(found.id);
      setCnpj(formatCNPJ(found.document || ""));
    } catch {
      localStorage.removeItem(LS_KEY);
    }
  }

  async function doLogin() {
    setError(null);
    setOkMsg(null);

    const selected = restaurants.find((r) => r.id === restaurantId);
    if (!selected) {
      setError("Restaurante inválido.");
      return;
    }

    const typed = onlyDigits(cnpj);
    const expected = onlyDigits(selected.document || "");

    if (!typed) {
      setError("Informe o CNPJ.");
      return;
    }

    if (typed.length !== 14) {
      setError("CNPJ inválido.");
      return;
    }

    setLoggingIn(true);
    try {
      if (typed !== expected) {
        throw new Error("CNPJ não confere com o restaurante.");
      }

      setLoggedRestaurant(selected);
      saveLogin(selected);
      setOkMsg("Restaurante validado.");
    } catch (e: any) {
      setError(e?.message || "Falha ao validar restaurante.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function refresh() {
    setError(null);
    setOkMsg(null);
    if (!loggedRestaurant?.id) return;

    setLoading(true);
    try {
      const { data: contracts, error: cErr } = await supabase
        .from("meal_contracts")
        .select("cutoff_lunch,cutoff_dinner,start_date,end_date")
        .eq("restaurant_id", loggedRestaurant.id)
        .lte("start_date", mealDate)
        .or(`end_date.is.null,end_date.gte.${mealDate}`);

      if (cErr) throw cErr;

      let maxLunch: string | null = null;
      let maxDinner: string | null = null;

      for (const c of (contracts || []) as ContractRow[]) {
        const l = toHHMM(c.cutoff_lunch);
        const d = toHHMM(c.cutoff_dinner);
        const lm = minutesFromHHMM(l);
        const dm = minutesFromHHMM(d);

        if (lm !== null) {
          const cur = minutesFromHHMM(maxLunch);
          if (cur === null || lm > cur) maxLunch = l!;
        }

        if (dm !== null) {
          const cur = minutesFromHHMM(maxDinner);
          if (cur === null || dm > cur) maxDinner = d!;
        }
      }

      setCutoffAtByShift({
        ALMOCO: buildCutoffISO_BRT(mealDate, maxLunch),
        JANTA: buildCutoffISO_BRT(mealDate, maxDinner),
      });

      const { data: orders, error: oErr } = await supabase
        .from("meal_orders")
        .select("id,worksite_id,shift,confirmed_at")
        .eq("restaurant_id", loggedRestaurant.id)
        .eq("meal_date", mealDate);

      if (oErr) throw oErr;

      const orows = (orders || []) as OrderRow[];
      const orderIds = orows.map((o) => String(o.id));

      const worksiteIds = Array.from(new Set(orows.map((o) => String(o.worksite_id)).filter(Boolean)));
      const wsMap = new Map<string, Worksite>();

      if (worksiteIds.length > 0) {
        const { data: ws, error: wErr } = await supabase
          .from("meal_worksites")
          .select("id,name,city")
          .in("id", worksiteIds);

        if (wErr) throw wErr;

        (ws || []).forEach((w: any) =>
          wsMap.set(String(w.id), {
            id: String(w.id),
            name: String(w.name),
            city: w.city ? String(w.city) : null,
          })
        );
      }

      const countByOrder = new Map<string, number>();
      if (orderIds.length > 0) {
        const { data: lines, error: lErr } = await supabase
          .from("meal_order_lines")
          .select("meal_order_id,included")
          .in("meal_order_id", orderIds)
          .eq("included", true);

        if (lErr) throw lErr;

        (lines || []).forEach((r: any) => {
          const oid = String(r.meal_order_id);
          countByOrder.set(oid, (countByOrder.get(oid) || 0) + 1);
        });
      }

      const agg: Record<Shift, Map<string, number>> = {
        ALMOCO: new Map(),
        JANTA: new Map(),
      };

      const hasShift: Record<Shift, boolean> = {
        ALMOCO: false,
        JANTA: false,
      };

      const conf: Record<Shift, boolean> = {
        ALMOCO: true,
        JANTA: true,
      };

      for (const o of orows) {
        const oid = String(o.id);
        const wid = String(o.worksite_id);
        const qty = countByOrder.get(oid) || 0;

        hasShift[o.shift] = true;
        agg[o.shift].set(wid, (agg[o.shift].get(wid) || 0) + qty);

        if (!o.confirmed_at) conf[o.shift] = false;
      }

      if (!hasShift.ALMOCO) conf.ALMOCO = false;
      if (!hasShift.JANTA) conf.JANTA = false;

      const listShift = (shift: Shift) =>
        Array.from(agg[shift].entries())
          .map(([wid, qty]) => {
            const w = wsMap.get(wid);
            const name = w ? `${w.name}${w.city ? " - " + w.city : ""}` : wid;
            return { worksite_id: wid, worksite_name: name, qty };
          })
          .sort((a, b) => b.qty - a.qty || a.worksite_name.localeCompare(b.worksite_name, "pt-BR"));

      const lunchList = listShift("ALMOCO");
      const dinnerList = listShift("JANTA");

      setByWorksite({
        ALMOCO: lunchList,
        JANTA: dinnerList,
      });

      setTotals({
        ALMOCO: lunchList.reduce((s, x) => s + x.qty, 0),
        JANTA: dinnerList.reduce((s, x) => s + x.qty, 0),
      });

      setConfirmedAll(conf);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const list = await loadRestaurants();
        if (!active) return;
        await tryAutoLogin(list);
      } catch (e: any) {
        if (active) setError(e?.message || "Falha ao carregar restaurantes.");
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loggedRestaurant?.id) return;
    refresh();
  }, [loggedRestaurant?.id, mealDate]);

  const confirmWindow = useMemo(() => {
    const today = isoTodayLocal();
    const now = new Date();
    const passed: Record<Shift, boolean> = {
      ALMOCO: false,
      JANTA: false,
    };

    for (const sh of ["ALMOCO", "JANTA"] as Shift[]) {
      if (mealDate < today) {
        passed[sh] = true;
        continue;
      }

      if (mealDate > today) {
        passed[sh] = false;
        continue;
      }

      const iso = cutoffAtByShift[sh];
      if (!iso) {
        passed[sh] = false;
        continue;
      }

      passed[sh] = now.getTime() >= new Date(iso).getTime();
    }

    return passed;
  }, [mealDate, cutoffAtByShift]);

  const canConfirm = useMemo(
    () => ({
      ALMOCO: totals.ALMOCO > 0 && !confirmedAll.ALMOCO && confirmWindow.ALMOCO,
      JANTA: totals.JANTA > 0 && !confirmedAll.JANTA && confirmWindow.JANTA,
    }),
    [totals, confirmedAll, confirmWindow]
  );

  async function confirmShift(shift: Shift) {
    setError(null);
    setOkMsg(null);
    if (!loggedRestaurant?.id) return;

    setConfirming((p) => ({ ...p, [shift]: true }));
    try {
      if (!confirmWindow[shift]) {
        throw new Error(`Só pode confirmar após ${hhmmFromISO(cutoffAtByShift[shift])}.`);
      }

      const attempt = await supabase
        .from("meal_orders")
        .update({
          status: "CONFIRMED" as any,
          confirmed_at: new Date().toISOString(),
        })
        .eq("restaurant_id", loggedRestaurant.id)
        .eq("meal_date", mealDate)
        .eq("shift", shift);

      if (attempt.error) {
        const msg = String(attempt.error.message || "");
        if (msg.includes("invalid input value for enum") || msg.includes("meal_order_status")) {
          const fallback = await supabase
            .from("meal_orders")
            .update({
              confirmed_at: new Date().toISOString(),
            })
            .eq("restaurant_id", loggedRestaurant.id)
            .eq("meal_date", mealDate)
            .eq("shift", shift);

          if (fallback.error) throw fallback.error;
        } else {
          throw attempt.error;
        }
      }

      setOkMsg(`${shift === "ALMOCO" ? "Almoço" : "Janta"} confirmado.`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Erro ao confirmar.");
    } finally {
      setConfirming((p) => ({ ...p, [shift]: false }));
    }
  }

  const selectedRestaurant = restaurants.find((r) => r.id === restaurantId) || null;

  if (!loggedRestaurant) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48 }}>
          <header className="page-header" style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img
                src="/gpasfalto-logo.png"
                alt="GP Asfalto"
                style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }}
              />
              <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>
                Restaurante
              </div>
              <div className="brand-text-sub">Totais do dia • Confirmar</div>
            </div>
          </header>

          <div className="section-card" style={{ maxWidth: 460, margin: "0 auto" }}>
            <div className="section-header">
              <div>
                <div className="section-title">Entrar</div>
                <div className="section-subtitle">
                  {lockedByLink
                    ? "Acesso travado para este restaurante. Informe apenas o CNPJ."
                    : "Selecione o restaurante e valide com o CNPJ."}
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

            <label style={styles.label}>Restaurante</label>
            {lockedByLink ? (
              <input
                style={{ ...styles.input, background: "#f8fafc" }}
                value={selectedRestaurant ? `${selectedRestaurant.name}${selectedRestaurant.city ? ` - ${selectedRestaurant.city}` : ""}` : ""}
                readOnly
              />
            ) : (
              <select
                style={styles.select}
                value={restaurantId}
                onChange={(e) => setRestaurantId(e.target.value)}
                disabled={restaurants.length === 0 || loggingIn}
              >
                <option value="">Selecione...</option>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.city ? ` - ${r.city}` : ""}
                  </option>
                ))}
              </select>
            )}

            <div style={{ height: 10 }} />

            <label style={styles.label}>CNPJ</label>
            <input
              style={styles.input}
              value={cnpj}
              onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
            />

            <div style={{ height: 10 }} />

            <button
              type="button"
              onClick={doLogin}
              disabled={loggingIn}
              style={{
                width: "100%",
                borderRadius: 14,
                border: "1px solid #93c5fd",
                background: "#2563eb",
                color: "#fff",
                padding: "12px 12px",
                fontSize: 15,
                fontWeight: 950,
                cursor: loggingIn ? "not-allowed" : "pointer",
                opacity: loggingIn ? 0.7 : 1,
              }}
            >
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 48 }}>
        <header className="page-header" style={{ position: "relative", justifyContent: "center", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }}
            />
            <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>
              Restaurante
            </div>
            <div className="brand-text-sub">Totais do dia • Confirmar</div>
          </div>

          <div style={{ position: "absolute", right: 0, top: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)", textAlign: "right" }}>
              <div>{loggedRestaurant.name}</div>
              <div>{loggedRestaurant.city || ""}</div>
            </div>
            {!lockedByLink ? (
              <button
                type="button"
                onClick={clearLogin}
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
                Trocar
              </button>
            ) : null}
          </div>
        </header>

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

        <div className="section-card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Restaurante validado</label>
              <input
                style={{ ...styles.input, background: "#f8fafc" }}
                value={`${loggedRestaurant.name}${loggedRestaurant.city ? ` - ${loggedRestaurant.city}` : ""}`}
                readOnly
              />
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input
                style={styles.input}
                type="date"
                value={mealDate}
                onChange={(e) => setMealDate(e.target.value)}
                disabled={loading}
              />
            </div>

            <div style={{ gridColumn: "span 6", display: "flex", alignItems: "flex-end" }}>
              <button
                type="button"
                onClick={refresh}
                style={{
                  width: "100%",
                  borderRadius: 14,
                  border: "1px solid #e5e7eb",
                  background: "#fff",
                  padding: "12px 12px",
                  fontSize: 15,
                  fontWeight: 900,
                  cursor: "pointer",
                }}
                disabled={loading}
              >
                {loading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>

            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Almoço
                </div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.ALMOCO}</div>
                <div style={{ fontSize: 12, color: "#166534" }}>
                  {confirmedAll.ALMOCO
                    ? "✅ Confirmado"
                    : confirmWindow.ALMOCO
                    ? "⏳ Aguardando confirmação"
                    : `🔒 Confirma após ${hhmmFromISO(cutoffAtByShift.ALMOCO)}`}
                </div>
              </div>

              <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Janta
                </div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.JANTA}</div>
                <div style={{ fontSize: 12, color: "#1d4ed8" }}>
                  {confirmedAll.JANTA
                    ? "✅ Confirmado"
                    : confirmWindow.JANTA
                    ? "⏳ Aguardando confirmação"
                    : `🔒 Confirma após ${hhmmFromISO(cutoffAtByShift.JANTA)}`}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Almoço</div>
              <div className="section-subtitle">Somente quantidades por obra.</div>
            </div>
          </div>

          {byWorksite.ALMOCO.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Sem pedidos de almoço para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {byWorksite.ALMOCO.map((x) => (
                <div
                  key={x.worksite_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid #eef2f7",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{x.worksite_name}</div>
                  <div style={{ fontWeight: 950 }}>{x.qty}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 10 }} />

          <button
            type="button"
            onClick={() => confirmShift("ALMOCO")}
            disabled={!canConfirm.ALMOCO || confirming.ALMOCO}
            style={{
              width: "100%",
              borderRadius: 14,
              padding: "14px 14px",
              fontSize: 16,
              fontWeight: 950,
              cursor: !canConfirm.ALMOCO ? "not-allowed" : "pointer",
              opacity: !canConfirm.ALMOCO ? 0.55 : 1,
              border: "1px solid #93c5fd",
              background: "#2563eb",
              color: "#fff",
            }}
          >
            {confirming.ALMOCO ? "Confirmando..." : "Confirmar Almoço"}
          </button>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Janta</div>
              <div className="section-subtitle">Somente quantidades por obra.</div>
            </div>
          </div>

          {byWorksite.JANTA.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Sem pedidos de janta para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {byWorksite.JANTA.map((x) => (
                <div
                  key={x.worksite_id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid #eef2f7",
                    background: "#fff",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{x.worksite_name}</div>
                  <div style={{ fontWeight: 950 }}>{x.qty}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 10 }} />

          <button
            type="button"
            onClick={() => confirmShift("JANTA")}
            disabled={!canConfirm.JANTA || confirming.JANTA}
            style={{
              width: "100%",
              borderRadius: 14,
              padding: "14px 14px",
              fontSize: 16,
              fontWeight: 950,
              cursor: !canConfirm.JANTA ? "not-allowed" : "pointer",
              opacity: !canConfirm.JANTA ? 0.55 : 1,
              border: "1px solid #93c5fd",
              background: "#2563eb",
              color: "#fff",
            }}
          >
            {confirming.JANTA ? "Confirmando..." : "Confirmar Janta"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--gp-muted-soft)", textAlign: "center" }}>
          * Este portal não mostra nomes, só quantidades por obra.
        </div>
      </div>
    </div>
  );
}

export default function RestaurantePage() {
  return (
    <Suspense fallback={<RestaurantePageFallback />}>
      <RestaurantePageInner />
    </Suspense>
  );
}

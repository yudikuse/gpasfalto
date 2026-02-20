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

type ContractRow = {
  worksite_id: string;
  cutoff_lunch: string | null;
  cutoff_dinner: string | null;
  start_date: string | null;
  end_date: string | null;
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

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeHHMM(t: string | null) {
  if (!t) return null;
  const parts = String(t).split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return String(t);
}

// pega o "mais tarde" (máximo) entre HH:MM / HH:MM:SS
function maxTime(a: string | null, b: string | null) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function buildAtLocal(mealDateISO: string, hhmmss: string | null) {
  if (!hhmmss) return null;
  const [y, m, d] = mealDateISO.split("-").map(Number);
  const parts = String(hhmmss).split(":").map((x) => Number(x));
  const hh = parts[0] ?? 0;
  const mm = parts[1] ?? 0;
  const ss = parts[2] ?? 0;
  return new Date(y, m - 1, d, hh, mm, ss);
}

function getOriginSafe() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

async function ensureSessionFromUrlIfAny() {
  if (typeof window === "undefined") return;

  // PKCE flow: ?code=...
  const code = new URLSearchParams(window.location.search).get("code");
  if (code) {
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } finally {
      // limpa query
      window.history.replaceState({}, "", window.location.pathname);
    }
    return;
  }

  // Implicit flow: #access_token=...&refresh_token=...
  const hash = window.location.hash?.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!hash) return;

  const params = new URLSearchParams(hash);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (access_token && refresh_token) {
    await supabase.auth.setSession({ access_token, refresh_token });
  }

  // limpa hash (sempre)
  window.history.replaceState({}, "", window.location.pathname);
}

export default function RestaurantePage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");

  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [totals, setTotals] = useState<Record<Shift, number>>({ ALMOCO: 0, JANTA: 0 });
  const [byWorksite, setByWorksite] = useState<
    Record<Shift, Array<{ worksite_id: string; worksite_name: string; qty: number }>>
  >({
    ALMOCO: [],
    JANTA: [],
  });

  const [confirmedAll, setConfirmedAll] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });
  const [limitTime, setLimitTime] = useState<Record<Shift, string | null>>({ ALMOCO: null, JANTA: null });

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUserId(null);
    setUserEmail("");
    setRestaurants([]);
    setRestaurantId("");
    setTotals({ ALMOCO: 0, JANTA: 0 });
    setByWorksite({ ALMOCO: [], JANTA: [] });
    setConfirmedAll({ ALMOCO: false, JANTA: false });
    setLimitTime({ ALMOCO: null, JANTA: null });
    router.replace("/refeicoes/restaurante"); // ✅ fica no login do restaurante
  }

  async function sendMagicLink() {
    const email = loginEmail.trim().toLowerCase();
    if (!email) return;

    setError(null);
    setOkMsg(null);
    setSendingLink(true);
    try {
      const redirectTo = `${getOriginSafe()}/refeicoes/restaurante`;
      const res = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (res.error) throw res.error;
      setOkMsg("Link enviado. Abra pelo e-mail (nesta mesma aba/dispositivo).");
    } catch (e: any) {
      setError(e?.message || "Falha ao enviar link.");
    } finally {
      setSendingLink(false);
    }
  }

  async function loadUserAndGuard() {
    await ensureSessionFromUrlIfAny();

    const { data } = await supabase.auth.getUser();
    const u = data?.user ?? null;

    setUserEmail(u?.email || "");
    const uid = u?.id || null;
    setUserId(uid);

    if (!uid) return null;

    // ✅ se NÃO for restaurante, não deixa ficar aqui
    const { data: ru, error: ruErr } = await supabase
      .from("meal_restaurant_users")
      .select("restaurant_id")
      .eq("user_id", uid)
      .limit(1)
      .maybeSingle();

    if (ruErr) throw ruErr;

    if (!ru?.restaurant_id) {
      router.replace("/refeicoes");
      return null;
    }

    return uid;
  }

  async function loadRestaurantsForUser(uid: string) {
    const { data: links, error: e1 } = await supabase
      .from("meal_restaurant_users")
      .select("restaurant_id")
      .eq("user_id", uid);

    if (e1) throw e1;

    const ids = (links || []).map((r: any) => String(r.restaurant_id)).filter(Boolean);
    if (ids.length === 0) {
      setRestaurants([]);
      setRestaurantId("");
      return;
    }

    const { data: rs, error: e2 } = await supabase
      .from("meal_restaurants")
      .select("id,name,city,active")
      .in("id", ids)
      .order("name", { ascending: true });

    if (e2) throw e2;

    const list = (rs || []) as Restaurant[];
    setRestaurants(list);
    if (!restaurantId && list[0]?.id) setRestaurantId(list[0].id);
  }

  async function refresh() {
    setError(null);
    setOkMsg(null);

    if (!restaurantId) return;

    setLoading(true);
    try {
      // contratos vigentes do restaurante na data
      const q = supabase
        .from("meal_contracts")
        .select("worksite_id,cutoff_lunch,cutoff_dinner,start_date,end_date")
        .eq("restaurant_id", restaurantId)
        .lte("start_date", mealDate);

      const { data: contracts, error: cErr } = await q.or(`end_date.is.null,end_date.gte.${mealDate}`);
      if (cErr) throw cErr;

      const crows = (contracts || []) as ContractRow[];

      // limite global do dia (pega o MAIS TARDE, pra confirmar só depois do último)
      let maxLunch: string | null = null;
      let maxDinner: string | null = null;
      for (const c of crows) {
        maxLunch = maxTime(maxLunch, c.cutoff_lunch);
        maxDinner = maxTime(maxDinner, c.cutoff_dinner);
      }
      setLimitTime({ ALMOCO: timeHHMM(maxLunch), JANTA: timeHHMM(maxDinner) });

      const worksiteIds = Array.from(new Set(crows.map((c) => String(c.worksite_id)).filter(Boolean)));

      // mapa de obras (nome)
      const wsMap = new Map<string, Worksite>();
      if (worksiteIds.length > 0) {
        const { data: ws, error: wErr } = await supabase
          .from("meal_worksites")
          .select("id,name,city")
          .in("id", worksiteIds);
        if (wErr) throw wErr;
        (ws || []).forEach((w: any) =>
          wsMap.set(String(w.id), { id: String(w.id), name: String(w.name), city: w.city ? String(w.city) : null })
        );
      }

      // pedidos do dia
      const { data: orders, error: oErr } = await supabase
        .from("meal_orders")
        .select("id,worksite_id,shift,confirmed_at")
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate);

      if (oErr) throw oErr;

      const orows = (orders || []) as OrderRow[];
      const orderIds = orows.map((o) => String(o.id));

      // linhas (pra contar quantidade)
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

      const agg: Record<Shift, Map<string, number>> = { ALMOCO: new Map(), JANTA: new Map() };
      const conf: Record<Shift, boolean> = { ALMOCO: true, JANTA: true };

      for (const o of orows) {
        const oid = String(o.id);
        const wid = String(o.worksite_id);
        const qty = countByOrder.get(oid) || 0;

        agg[o.shift].set(wid, (agg[o.shift].get(wid) || 0) + qty);

        if (!o.confirmed_at) conf[o.shift] = false;
      }

      // se não tem pedidos daquele turno, mantém como não confirmado (evita “dar ok” sem ver)
      if (orows.filter((x) => x.shift === "ALMOCO").length === 0) conf.ALMOCO = false;
      if (orows.filter((x) => x.shift === "JANTA").length === 0) conf.JANTA = false;

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

      setByWorksite({ ALMOCO: lunchList, JANTA: dinnerList });
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
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const uid = await loadUserAndGuard();
        if (!uid || !mounted) return;
        await loadRestaurantsForUser(uid);
      } catch (e: any) {
        if (mounted) setError(e?.message || "Falha ao carregar.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const u = session?.user ?? null;
      setUserId(u?.id ?? null);
      setUserEmail(u?.email ?? "");

      // quando logar via magic link, carrega restaurantes automaticamente
      if (u?.id) {
        try {
          await loadRestaurantsForUser(u.id);
        } catch {
          // silencioso
        }
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restaurantId) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, mealDate]);

  const canConfirm = useMemo(() => {
    const today = isoTodayLocal();
    const now = new Date();

    const lunchAt = buildAtLocal(mealDate, limitTime.ALMOCO ? `${limitTime.ALMOCO}:00` : null);
    const dinnerAt = buildAtLocal(mealDate, limitTime.JANTA ? `${limitTime.JANTA}:00` : null);

    const base = (shift: Shift, dt: Date | null) => {
      if (confirmedAll[shift]) return false;
      if (!dt) return false; // sem horário limite => bloqueia
      if (mealDate === today) return now.getTime() >= dt.getTime();
      if (mealDate < today) return true; // passado: pode confirmar
      return false; // futuro: bloqueia
    };

    return { ALMOCO: base("ALMOCO", lunchAt), JANTA: base("JANTA", dinnerAt) };
  }, [mealDate, limitTime, confirmedAll]);

  async function confirmShift(shift: Shift) {
    setError(null);
    setOkMsg(null);

    if (!restaurantId || !userId) return;

    setConfirming((p) => ({ ...p, [shift]: true }));
    try {
      // tenta atualizar status também; se o enum não aceitar, faz fallback só no confirmed_at
      const attempt = await supabase
        .from("meal_orders")
        .update({
          status: "CONFIRMED" as any,
          confirmed_at: new Date().toISOString(),
          updated_by: userId,
        })
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate)
        .eq("shift", shift);

      if (attempt.error) {
        const msg = String(attempt.error.message || "");
        if (msg.includes("invalid input value for enum") || msg.includes("meal_order_status")) {
          const fallback = await supabase
            .from("meal_orders")
            .update({
              confirmed_at: new Date().toISOString(),
              updated_by: userId,
            })
            .eq("restaurant_id", restaurantId)
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

  // ✅ Se não está logado, mostra login do restaurante (mesma rota)
  if (!userId) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48, display: "grid", placeItems: "center", minHeight: "80vh" }}>
          <div style={{ textAlign: "center" }}>
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 38, height: 38, objectFit: "contain", border: "none", background: "transparent" }} />
            <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 10 }}>
              Restaurante
            </div>
            <div className="brand-text-sub">Totais do dia • Confirmar</div>
          </div>

          <div style={{ width: "100%", maxWidth: 360, marginTop: 18 }} className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Entrar</div>
                <div className="section-subtitle">Acesso do restaurante.</div>
              </div>
            </div>

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

            <label style={styles.label}>E-mail</label>
            <input
              style={styles.input}
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              inputMode="email"
            />

            <div style={{ height: 10 }} />

            <button
              type="button"
              onClick={sendMagicLink}
              disabled={sendingLink}
              style={{
                width: "100%",
                borderRadius: 14,
                padding: "14px 14px",
                fontSize: 16,
                fontWeight: 950,
                cursor: sendingLink ? "not-allowed" : "pointer",
                opacity: sendingLink ? 0.7 : 1,
                border: "1px solid #93c5fd",
                background: "#2563eb",
                color: "#fff",
              }}
            >
              {sendingLink ? "Enviando..." : "Enviar link de acesso"}
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
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 38, height: 38, objectFit: "contain", border: "none", background: "transparent" }} />
            <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>
              Restaurante
            </div>
            <div className="brand-text-sub">Totais do dia • Confirmar</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>
          </div>

          <div style={{ position: "absolute", right: 0, top: 0, display: "flex", alignItems: "center", gap: 10 }}>
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
              <label style={styles.label}>Restaurante</label>
              <select style={styles.select} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} disabled={loading || restaurants.length <= 1}>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.city ? ` - ${r.city}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={mealDate} onChange={(e) => setMealDate(e.target.value)} disabled={loading} />
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
                <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.ALMOCO}</div>
                <div style={{ fontSize: 12, color: "#166534" }}>{confirmedAll.ALMOCO ? "✅ Confirmado" : "⏳ Aguardando confirmação"}</div>
              </div>

              <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.JANTA}</div>
                <div style={{ fontSize: 12, color: "#1d4ed8" }}>{confirmedAll.JANTA ? "✅ Confirmado" : "⏳ Aguardando confirmação"}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="section-card" style={{ marginTop: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Almoço</div>
              <div className="section-subtitle">Somente quantidades por obra. Confirmar após o horário limite.</div>
            </div>
          </div>

          {byWorksite.ALMOCO.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Sem pedidos de almoço para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {byWorksite.ALMOCO.map((x) => (
                <div key={x.worksite_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid #eef2f7", background: "#fff" }}>
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
              <div className="section-subtitle">Somente quantidades por obra. Confirmar após o horário limite.</div>
            </div>
          </div>

          {byWorksite.JANTA.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--gp-muted-soft)" }}>Sem pedidos de janta para este dia.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {byWorksite.JANTA.map((x) => (
                <div key={x.worksite_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid #eef2f7", background: "#fff" }}>
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
          * Este portal não mostra nomes (só quantidades). A empresa mantém os detalhes.
        </div>
      </div>
    </div>
  );
}

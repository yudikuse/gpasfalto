"use client";

// FIX: race condition no onAuthStateChange
//
// Problema original: onAuthStateChange dispara múltiplas vezes
// (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED). Cada disparo
// chamava loadUserAndGuard() que podia redirecionar para /refeicoes
// se a query ainda não tinha retornado — causando loop infinito.
//
// Correção: useRef `guardDone` — após o primeiro carregamento
// bem-sucedido (uid encontrado + restaurant_id encontrado),
// as chamadas subsequentes do onAuthStateChange são ignoradas.
// O redirect para /refeicoes só acontece se guardDone.current
// ainda for false (primeira chamada real).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  confirmed_at: string | null;
};

type ContractRow = {
  cutoff_lunch: string | null;
  cutoff_dinner: string | null;
  start_date: string | null;
  end_date: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function isoTodayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

export default function RestaurantePage() {
  const router = useRouter();

  const [userEmail, setUserEmail] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>("");
  const [mealDate, setMealDate] = useState<string>(isoTodayLocal());

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [totals, setTotals] = useState<Record<Shift, number>>({ ALMOCO: 0, JANTA: 0 });
  const [byWorksite, setByWorksite] = useState<Record<Shift, Array<{ worksite_id: string; worksite_name: string; qty: number }>>>({
    ALMOCO: [],
    JANTA: [],
  });
  const [confirmedAll, setConfirmedAll] = useState<Record<Shift, boolean>>({ ALMOCO: false, JANTA: false });
  const [cutoffAtByShift, setCutoffAtByShift] = useState<Record<Shift, string | null>>({ ALMOCO: null, JANTA: null });

  // ── FIX: evita que o onAuthStateChange rode o guard mais de uma vez ──
  const guardDone = useRef(false);

  const styles: Record<string, CSSProperties> = {
    label: { fontSize: 12, fontWeight: 800, color: "var(--gp-muted)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 },
    input: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
    select: { width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", padding: "12px 12px", fontSize: 16, outline: "none", background: "#ffffff", color: "var(--gp-text)" },
  };

  async function handleSignOut() {
    await supabase.auth.signOut();
    guardDone.current = false;
    setUserId(null);
    setUserEmail("");
    router.replace("/refeicoes/restaurante");
  }

  async function doLoginWithEmailPin() {
    setError(null);
    setOkMsg(null);
    const email = loginEmail.trim().toLowerCase();
    const pin = (loginPin || "").trim();
    if (!email) return setError("Informe o e-mail."), undefined;
    if (!pin) return setError("Informe o PIN."), undefined;
    setLoggingIn(true);
    try {
      const { error: e } = await supabase.auth.signInWithPassword({ email, password: pin });
      if (e) throw e;
      setOkMsg("Login OK.");
    } catch (e: any) {
      setError(e?.message || "Falha no login.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function loadUserAndGuard(): Promise<string | null> {
    await supabase.auth.getSession();
    const { data } = await supabase.auth.getUser();
    const u = data?.user ?? null;

    setUserEmail(u?.email || "");
    setUserId(u?.id || null);

    if (!u?.id) return null;

    const { data: ru, error: ruErr } = await supabase
      .from("meal_restaurant_users")
      .select("restaurant_id")
      .eq("user_id", u.id)
      .limit(1)
      .maybeSingle();

    if (ruErr) throw ruErr;

    if (!ru?.restaurant_id) {
      // Só redireciona se ainda não confirmamos que é restaurante
      if (!guardDone.current) {
        router.replace("/refeicoes");
      }
      return null;
    }

    // Marcamos que o guard foi concluído com sucesso
    guardDone.current = true;
    return u.id;
  }

  async function loadRestaurantsForUser(uid: string) {
    const { data: links, error: e1 } = await supabase
      .from("meal_restaurant_users")
      .select("restaurant_id")
      .eq("user_id", uid);
    if (e1) throw e1;

    const ids = (links || []).map((r: any) => String(r.restaurant_id)).filter(Boolean);
    if (ids.length === 0) { setRestaurants([]); setRestaurantId(""); return; }

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
      // Cutoff do contrato
      const { data: contracts, error: cErr } = await supabase
        .from("meal_contracts")
        .select("cutoff_lunch,cutoff_dinner,start_date,end_date")
        .eq("restaurant_id", restaurantId)
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
        if (lm !== null) { const cur = minutesFromHHMM(maxLunch); if (cur === null || lm > cur) maxLunch = l!; }
        if (dm !== null) { const cur = minutesFromHHMM(maxDinner); if (cur === null || dm > cur) maxDinner = d!; }
      }

      setCutoffAtByShift({
        ALMOCO: buildCutoffISO_BRT(mealDate, maxLunch),
        JANTA: buildCutoffISO_BRT(mealDate, maxDinner),
      });

      // Pedidos do dia
      const { data: orders, error: oErr } = await supabase
        .from("meal_orders")
        .select("id,worksite_id,shift,confirmed_at")
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate);
      if (oErr) throw oErr;

      const orows = (orders || []) as OrderRow[];
      const orderIds = orows.map((o) => String(o.id));

      // Obras
      const worksiteIds = Array.from(new Set(orows.map((o) => String(o.worksite_id)).filter(Boolean)));
      const wsMap = new Map<string, Worksite>();
      if (worksiteIds.length > 0) {
        const { data: ws, error: wErr } = await supabase.from("meal_worksites").select("id,name,city").in("id", worksiteIds);
        if (wErr) throw wErr;
        (ws || []).forEach((w: any) => wsMap.set(String(w.id), { id: String(w.id), name: String(w.name), city: w.city ? String(w.city) : null }));
      }

      // Linhas (quantidade)
      const countByOrder = new Map<string, number>();
      if (orderIds.length > 0) {
        const { data: lines, error: lErr } = await supabase.from("meal_order_lines").select("meal_order_id,included").in("meal_order_id", orderIds).eq("included", true);
        if (lErr) throw lErr;
        (lines || []).forEach((r: any) => {
          const oid = String(r.meal_order_id);
          countByOrder.set(oid, (countByOrder.get(oid) || 0) + 1);
        });
      }

      const agg: Record<Shift, Map<string, number>> = { ALMOCO: new Map(), JANTA: new Map() };
      const hasShift: Record<Shift, boolean> = { ALMOCO: false, JANTA: false };
      const conf: Record<Shift, boolean> = { ALMOCO: true, JANTA: true };

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

      setByWorksite({ ALMOCO: lunchList, JANTA: dinnerList });
      setTotals({ ALMOCO: lunchList.reduce((s, x) => s + x.qty, 0), JANTA: dinnerList.reduce((s, x) => s + x.qty, 0) });
      setConfirmedAll(conf);
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    // FIX: flag local para evitar execuções paralelas
    let running = false;

    const run = async () => {
      if (running) return; // ignora se já está rodando
      running = true;
      setLoading(true);
      setError(null);
      try {
        const uid = await loadUserAndGuard();
        if (!alive) return;
        if (!uid) return;
        await loadRestaurantsForUser(uid);
      } catch (e: any) {
        if (alive) setError(e?.message || "Falha ao carregar.");
      } finally {
        running = false;
        if (alive) setLoading(false);
      }
    };

    run();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      // FIX: ignora eventos que não são login novo ou logout
      // TOKEN_REFRESHED e outros eventos intermediários não devem
      // re-executar o guard completo
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        if (event === "SIGNED_OUT") {
          guardDone.current = false;
          setUserId(null);
          setUserEmail("");
          setRestaurants([]);
          setRestaurantId("");
          return;
        }
        run();
      }
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restaurantId || !userId) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, mealDate, userId]);

  const confirmWindow = useMemo(() => {
    const today = isoTodayLocal();
    const now = new Date();
    const passed: Record<Shift, boolean> = { ALMOCO: false, JANTA: false };
    for (const sh of ["ALMOCO", "JANTA"] as Shift[]) {
      if (mealDate < today) { passed[sh] = true; continue; }
      if (mealDate > today) { passed[sh] = false; continue; }
      const iso = cutoffAtByShift[sh];
      if (!iso) { passed[sh] = false; continue; }
      passed[sh] = now.getTime() >= new Date(iso).getTime();
    }
    return passed;
  }, [mealDate, cutoffAtByShift]);

  const canConfirm = useMemo(() => ({
    ALMOCO: totals.ALMOCO > 0 && !confirmedAll.ALMOCO && confirmWindow.ALMOCO,
    JANTA: totals.JANTA > 0 && !confirmedAll.JANTA && confirmWindow.JANTA,
  }), [totals, confirmedAll, confirmWindow]);

  async function confirmShift(shift: Shift) {
    setError(null);
    setOkMsg(null);
    if (!restaurantId || !userId) return;
    setConfirming((p) => ({ ...p, [shift]: true }));
    try {
      if (!confirmWindow[shift]) {
        throw new Error(`Só pode confirmar após ${hhmmFromISO(cutoffAtByShift[shift])}.`);
      }

      const attempt = await supabase
        .from("meal_orders")
        .update({ status: "CONFIRMED" as any, confirmed_at: new Date().toISOString(), updated_by: userId })
        .eq("restaurant_id", restaurantId)
        .eq("meal_date", mealDate)
        .eq("shift", shift);

      if (attempt.error) {
        const msg = String(attempt.error.message || "");
        if (msg.includes("invalid input value for enum") || msg.includes("meal_order_status")) {
          const fallback = await supabase
            .from("meal_orders")
            .update({ confirmed_at: new Date().toISOString(), updated_by: userId })
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

  // ── LOGIN ──────────────────────────────────────────────────
  if (!userId) {
    return (
      <div className="page-root">
        <div className="page-container" style={{ paddingBottom: 48 }}>
          <header className="page-header" style={{ justifyContent: "center", alignItems: "center" }}>
            <div style={{ textAlign: "center" }}>
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
              <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>Restaurante</div>
              <div className="brand-text-sub">Totais do dia • Confirmar</div>
            </div>
          </header>
          <div className="section-card" style={{ maxWidth: 420, margin: "0 auto" }}>
            <div className="section-header">
              <div>
                <div className="section-title">Entrar</div>
                <div className="section-subtitle">Use E-mail + PIN.</div>
              </div>
            </div>
            {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
            {okMsg ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>{okMsg}</div> : null}
            <label style={styles.label}>E-mail</label>
            <input style={styles.input} value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="seu@email.com" autoCapitalize="none" />
            <div style={{ height: 10 }} />
            <label style={styles.label}>PIN</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...styles.input, flex: 1 }} type={showPin ? "text" : "password"} value={loginPin} onChange={(e) => setLoginPin(e.target.value)} placeholder="••••••" />
              <button type="button" onClick={() => setShowPin((p) => !p)} style={{ borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", padding: "12px 12px", fontSize: 13, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap" }}>
                {showPin ? "Ocultar" : "Mostrar"}
              </button>
            </div>
            <div style={{ height: 10 }} />
            <button type="button" onClick={doLoginWithEmailPin} disabled={loggingIn} style={{ width: "100%", borderRadius: 14, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff", padding: "12px 12px", fontSize: 15, fontWeight: 950, cursor: loggingIn ? "not-allowed" : "pointer", opacity: loggingIn ? 0.7 : 1 }}>
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PÁGINA PRINCIPAL ───────────────────────────────────────
  return (
    <div className="page-root">
      <div className="page-container" style={{ paddingBottom: 48 }}>
        <header className="page-header" style={{ position: "relative", justifyContent: "center", alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ width: 34, height: 34, objectFit: "contain", border: "none", background: "transparent" }} />
            <div className="brand-text-main" style={{ lineHeight: 1.1, marginTop: 6 }}>Restaurante</div>
            <div className="brand-text-sub">Totais do dia • Confirmar</div>
          </div>
          <div style={{ position: "absolute", right: 0, top: 0, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, color: "var(--gp-muted-soft)" }}>{userEmail ? `Logado: ${userEmail}` : ""}</div>
            <button type="button" onClick={handleSignOut} style={{ borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", padding: "8px 12px", fontSize: 13, fontWeight: 900, cursor: "pointer" }}>Sair</button>
          </div>
        </header>

        {error ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", fontSize: 14, marginBottom: 12 }}>{error}</div> : null}
        {okMsg ? <div style={{ borderRadius: 14, padding: "10px 12px", border: "1px solid #bbf7d0", background: "#f0fdf4", color: "#166534", fontSize: 14, marginBottom: 12 }}>{okMsg}</div> : null}

        <div className="section-card">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 12 }}>
            <div style={{ gridColumn: "span 12" }}>
              <label style={styles.label}>Restaurante</label>
              <select style={styles.select} value={restaurantId} onChange={(e) => setRestaurantId(e.target.value)} disabled={loading || restaurants.length <= 1}>
                {restaurants.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.city ? ` - ${r.city}` : ""}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: "span 6" }}>
              <label style={styles.label}>Data</label>
              <input style={styles.input} type="date" value={mealDate} onChange={(e) => setMealDate(e.target.value)} disabled={loading} />
            </div>
            <div style={{ gridColumn: "span 6", display: "flex", alignItems: "flex-end" }}>
              <button type="button" onClick={refresh} style={{ width: "100%", borderRadius: 14, border: "1px solid #e5e7eb", background: "#fff", padding: "12px 12px", fontSize: 15, fontWeight: 900, cursor: "pointer" }} disabled={loading}>
                {loading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
            <div style={{ gridColumn: "span 12", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div style={{ borderRadius: 16, border: "1px solid #86efac", background: "#ecfdf5", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#166534", textTransform: "uppercase", letterSpacing: "0.08em" }}>Almoço</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.ALMOCO}</div>
                <div style={{ fontSize: 12, color: "#166534" }}>
                  {confirmedAll.ALMOCO ? "✅ Confirmado" : confirmWindow.ALMOCO ? "⏳ Aguardando confirmação" : `🔒 Confirma após ${hhmmFromISO(cutoffAtByShift.ALMOCO)}`}
                </div>
              </div>
              <div style={{ borderRadius: 16, border: "1px solid #93c5fd", background: "#eff6ff", padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Janta</div>
                <div style={{ fontSize: 26, fontWeight: 950, color: "#0f172a", lineHeight: 1.1 }}>{totals.JANTA}</div>
                <div style={{ fontSize: 12, color: "#1d4ed8" }}>
                  {confirmedAll.JANTA ? "✅ Confirmado" : confirmWindow.JANTA ? "⏳ Aguardando confirmação" : `🔒 Confirma após ${hhmmFromISO(cutoffAtByShift.JANTA)}`}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Almoço */}
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
                <div key={x.worksite_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid #eef2f7", background: "#fff" }}>
                  <div style={{ fontWeight: 800 }}>{x.worksite_name}</div>
                  <div style={{ fontWeight: 950 }}>{x.qty}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ height: 10 }} />
          <button type="button" onClick={() => confirmShift("ALMOCO")} disabled={!canConfirm.ALMOCO || confirming.ALMOCO}
            style={{ width: "100%", borderRadius: 14, padding: "14px 14px", fontSize: 16, fontWeight: 950, cursor: !canConfirm.ALMOCO ? "not-allowed" : "pointer", opacity: !canConfirm.ALMOCO ? 0.55 : 1, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff" }}>
            {confirming.ALMOCO ? "Confirmando..." : "Confirmar Almoço"}
          </button>
        </div>

        {/* Janta */}
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
                <div key={x.worksite_id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid #eef2f7", background: "#fff" }}>
                  <div style={{ fontWeight: 800 }}>{x.worksite_name}</div>
                  <div style={{ fontWeight: 950 }}>{x.qty}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ height: 10 }} />
          <button type="button" onClick={() => confirmShift("JANTA")} disabled={!canConfirm.JANTA || confirming.JANTA}
            style={{ width: "100%", borderRadius: 14, padding: "14px 14px", fontSize: 16, fontWeight: 950, cursor: !canConfirm.JANTA ? "not-allowed" : "pointer", opacity: !canConfirm.JANTA ? 0.55 : 1, border: "1px solid #93c5fd", background: "#2563eb", color: "#fff" }}>
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

"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Funcionario = {
  id: string;
  nome: string;
};

type Saldo = {
  funcionario_id: string;
  funcionario: string;
  ativo: boolean;
  total_credito: number;
  total_gasto: number;
  saldo: number;
  gastos_pendentes: number;
};

type Gasto = {
  id: string;
  funcionario_id: string;
  valor: number;
  descricao: string;
  categoria: string;
  foto_url: string;
  conferido: boolean;
  created_at: string;
  funcionario?: {
    nome: string;
  };
};

function moneyBR(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dateBR(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("pt-BR");
}

function parseMoneyBR(value: string) {
  const clean = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  return (Number(digits) / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdiantamentosPage() {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [gastos, setGastos] = useState<Gasto[]>([]);

  const [funcionarioId, setFuncionarioId] = useState("");
  const [valorCredito, setValorCredito] = useState("");
  const [obra, setObra] = useState("");
  const [observacao, setObservacao] = useState("");

  const [filtroFuncionario, setFiltroFuncionario] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const saldoSelecionado = useMemo(() => {
    return saldos.find((s) => s.funcionario_id === funcionarioId);
  }, [saldos, funcionarioId]);

  const gastosFiltrados = useMemo(() => {
    if (!filtroFuncionario) return gastos;
    return gastos.filter((g) => g.funcionario_id === filtroFuncionario);
  }, [gastos, filtroFuncionario]);

  useEffect(() => {
    carregar();
  }, []);

  async function carregar() {
    const { data: funcionariosData } = await supabase
      .from("adiantamento_funcionarios")
      .select("id,nome")
      .eq("ativo", true)
      .order("nome", { ascending: true });

    const { data: saldosData } = await supabase
      .from("adiantamento_saldos_v")
      .select("*")
      .eq("ativo", true)
      .order("funcionario", { ascending: true });

    const { data: gastosData } = await supabase
      .from("adiantamento_gastos")
      .select(
        `
        id,
        funcionario_id,
        valor,
        descricao,
        categoria,
        foto_url,
        conferido,
        created_at,
        funcionario:adiantamento_funcionarios(nome)
      `
      )
      .order("created_at", { ascending: false })
      .limit(200);

    setFuncionarios(funcionariosData || []);
    setSaldos(saldosData || []);
    setGastos((gastosData as any[]) || []);
  }

  async function salvarCredito() {
    setMsg("");

    const valor = parseMoneyBR(valorCredito);

    if (!funcionarioId) {
      setMsg("Selecione o colaborador.");
      return;
    }

    if (!valor || valor <= 0) {
      setMsg("Informe o valor do adiantamento.");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.from("adiantamento_creditos").insert({
        funcionario_id: funcionarioId,
        valor,
        obra: obra.trim() || null,
        observacao: observacao.trim() || null,
        criado_por: "encarregado",
      });

      if (error) throw new Error(error.message);

      setValorCredito("");
      setObra("");
      setObservacao("");
      setMsg("Adiantamento lançado com sucesso.");

      await carregar();
    } catch (e: any) {
      setMsg(`Erro: ${e.message || "não foi possível salvar"}`);
    } finally {
      setLoading(false);
    }
  }

  async function marcarConferido(gastoId: string) {
    setMsg("");

    try {
      const { error } = await supabase.rpc("adiantamento_marcar_conferido", {
        p_gasto_id: gastoId,
        p_usuario: "encarregado",
      });

      if (error) throw new Error(error.message);

      await carregar();
    } catch (e: any) {
      setMsg(`Erro: ${e.message || "não foi possível conferir"}`);
    }
  }

  return (
    <main className="page">
      <div className="header">
        <div>
          <p className="eyebrow">GP Asfalto</p>
          <h1>Adiantamentos</h1>
        </div>

        <button className="printBtn" onClick={() => window.print()}>
          Gerar PDF
        </button>
      </div>

      <section className="grid">
        <div className="card">
          <h2>Lançar adiantamento</h2>

          <label>Colaborador</label>
          <select
            value={funcionarioId}
            onChange={(e) => setFuncionarioId(e.target.value)}
          >
            <option value="">Selecione</option>
            {funcionarios.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>

          {saldoSelecionado && (
            <div className="saldoMini">
              Saldo atual: <strong>{moneyBR(saldoSelecionado.saldo)}</strong>
            </div>
          )}

          <label>Valor do crédito</label>
          <input
            inputMode="numeric"
            placeholder="0,00"
            value={valorCredito}
            onChange={(e) => setValorCredito(formatMoneyInput(e.target.value))}
          />

          <label>Obra</label>
          <input
            placeholder="Ex: Acreúna, Usina, Rota..."
            value={obra}
            onChange={(e) => setObra(e.target.value)}
          />

          <label>Observação</label>
          <textarea
            placeholder="Ex: viagem, deslocamento, refeição..."
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
          />

          {msg && <div className="msg">{msg}</div>}

          <button className="primaryBtn" onClick={salvarCredito} disabled={loading}>
            {loading ? "Salvando..." : "Lançar crédito"}
          </button>
        </div>

        <div className="card">
          <h2>Saldos</h2>

          <div className="saldoList">
            {saldos.map((s) => (
              <button
                key={s.funcionario_id}
                className={
                  filtroFuncionario === s.funcionario_id
                    ? "saldoItem active"
                    : "saldoItem"
                }
                onClick={() =>
                  setFiltroFuncionario(
                    filtroFuncionario === s.funcionario_id
                      ? ""
                      : s.funcionario_id
                  )
                }
              >
                <div>
                  <strong>{s.funcionario}</strong>
                  <small>
                    Crédito {moneyBR(s.total_credito)} · Gasto{" "}
                    {moneyBR(s.total_gasto)}
                  </small>
                </div>

                <span className={Number(s.saldo) < 0 ? "saldo neg" : "saldo"}>
                  {moneyBR(s.saldo)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card full">
        <div className="sectionTop">
          <h2>Comprovantes enviados</h2>

          {filtroFuncionario && (
            <button className="clearBtn" onClick={() => setFiltroFuncionario("")}>
              Limpar filtro
            </button>
          )}
        </div>

        <div className="gastos">
          {gastosFiltrados.map((g) => (
            <div key={g.id} className="gastoCard">
              <a href={g.foto_url} target="_blank" className="thumb">
                <img src={g.foto_url} alt="Comprovante" />
              </a>

              <div className="gastoInfo">
                <div className="gastoTop">
                  <strong>{g.funcionario?.nome || "Colaborador"}</strong>
                  <span>{moneyBR(g.valor)}</span>
                </div>

                <div className="desc">
                  {g.categoria} · {g.descricao}
                </div>

                <div className="date">{dateBR(g.created_at)}</div>

                <div className="actions">
                  {g.conferido ? (
                    <span className="ok">Conferido</span>
                  ) : (
                    <button onClick={() => marcarConferido(g.id)}>
                      Marcar conferido
                    </button>
                  )}

                  <a href={g.foto_url} target="_blank">
                    Abrir foto
                  </a>
                </div>
              </div>
            </div>
          ))}

          {gastosFiltrados.length === 0 && (
            <div className="empty">Nenhum comprovante encontrado.</div>
          )}
        </div>
      </section>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f3f5f8;
          color: #111827;
          font-family: Arial, sans-serif;
          padding: 22px;
        }

        .header {
          max-width: 1180px;
          margin: 0 auto 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
        }

        .eyebrow {
          margin: 0 0 4px;
          color: #6b7280;
          font-size: 13px;
          font-weight: 900;
          text-transform: uppercase;
        }

        h1 {
          margin: 0;
          font-size: 34px;
        }

        h2 {
          margin: 0 0 16px;
          font-size: 22px;
        }

        .grid {
          max-width: 1180px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: 420px 1fr;
          gap: 18px;
        }

        .card {
          background: white;
          border-radius: 22px;
          padding: 18px;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.1);
        }

        .full {
          max-width: 1180px;
          margin: 18px auto 0;
        }

        label {
          display: block;
          margin: 14px 0 7px;
          font-size: 14px;
          font-weight: 900;
          color: #374151;
        }

        input,
        select,
        textarea {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 14px;
          padding: 13px;
          font-size: 16px;
          outline: none;
          background: white;
        }

        textarea {
          min-height: 80px;
          resize: none;
        }

        .saldoMini {
          margin-top: 12px;
          padding: 12px;
          border-radius: 14px;
          background: #f9fafb;
          font-weight: 800;
        }

        .primaryBtn,
        .printBtn {
          border: 0;
          border-radius: 16px;
          padding: 14px 18px;
          font-size: 16px;
          font-weight: 900;
          color: white;
          background: #111827;
          cursor: pointer;
        }

        .primaryBtn {
          width: 100%;
          margin-top: 16px;
          background: #16a34a;
        }

        .primaryBtn:disabled {
          opacity: 0.6;
        }

        .msg {
          margin-top: 14px;
          padding: 13px;
          border-radius: 14px;
          background: #fff7ed;
          color: #9a3412;
          font-weight: 800;
        }

        .saldoList {
          display: grid;
          gap: 10px;
        }

        .saldoItem {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          border-radius: 16px;
          padding: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 14px;
          text-align: left;
          cursor: pointer;
        }

        .saldoItem.active {
          border-color: #111827;
          background: #eef2ff;
        }

        .saldoItem strong {
          display: block;
          font-size: 15px;
        }

        .saldoItem small {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        .saldo {
          font-weight: 900;
          font-size: 17px;
          white-space: nowrap;
        }

        .saldo.neg {
          color: #dc2626;
        }

        .sectionTop {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }

        .clearBtn {
          border: 0;
          border-radius: 999px;
          padding: 9px 13px;
          background: #e5e7eb;
          font-weight: 900;
          cursor: pointer;
        }

        .gastos {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .gastoCard {
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          padding: 12px;
          display: grid;
          grid-template-columns: 96px 1fr;
          gap: 12px;
          background: #fff;
        }

        .thumb {
          width: 96px;
          height: 96px;
          border-radius: 14px;
          overflow: hidden;
          background: #f3f4f6;
          display: block;
        }

        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .gastoInfo {
          min-width: 0;
        }

        .gastoTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }

        .gastoTop strong {
          font-size: 15px;
        }

        .gastoTop span {
          font-size: 17px;
          font-weight: 900;
          white-space: nowrap;
        }

        .desc {
          margin-top: 5px;
          color: #374151;
          font-size: 14px;
          font-weight: 700;
        }

        .date {
          margin-top: 5px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        .actions {
          margin-top: 10px;
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .actions button,
        .actions a {
          border: 0;
          border-radius: 999px;
          padding: 8px 11px;
          background: #111827;
          color: white;
          font-size: 12px;
          font-weight: 900;
          text-decoration: none;
          cursor: pointer;
        }

        .actions a {
          background: #e5e7eb;
          color: #111827;
        }

        .ok {
          border-radius: 999px;
          padding: 8px 11px;
          background: #dcfce7;
          color: #166534;
          font-size: 12px;
          font-weight: 900;
        }

        .empty {
          padding: 22px;
          border-radius: 16px;
          background: #f9fafb;
          font-weight: 800;
          color: #6b7280;
        }

        @media (max-width: 900px) {
          .page {
            padding: 12px;
          }

          .header {
            display: block;
          }

          .printBtn {
            width: 100%;
            margin-top: 12px;
          }

          .grid {
            grid-template-columns: 1fr;
          }

          .gastos {
            grid-template-columns: 1fr;
          }
        }

        @media print {
          .page {
            background: white;
            padding: 0;
          }

          .printBtn,
          .primaryBtn,
          .clearBtn,
          .actions button {
            display: none;
          }

          .card {
            box-shadow: none;
            border: 1px solid #ddd;
          }

          .grid {
            grid-template-columns: 1fr;
          }

          .gastos {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  );
}

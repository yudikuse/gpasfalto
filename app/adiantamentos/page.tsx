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

type Credito = {
  id: string;
  funcionario_id: string;
  valor: number;
  obra: string | null;
  observacao: string | null;
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
  const [creditos, setCreditos] = useState<Credito[]>([]);

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

  const creditosFiltrados = useMemo(() => {
    if (!filtroFuncionario) return creditos;
    return creditos.filter((c) => c.funcionario_id === filtroFuncionario);
  }, [creditos, filtroFuncionario]);

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

    const { data: creditosData } = await supabase
      .from("adiantamento_creditos")
      .select(
        `
        id,
        funcionario_id,
        valor,
        obra,
        observacao,
        created_at,
        funcionario:adiantamento_funcionarios(nome)
      `
      )
      .order("created_at", { ascending: false })
      .limit(200);

    setFuncionarios(funcionariosData || []);
    setSaldos(saldosData || []);
    setGastos((gastosData as any[]) || []);
    setCreditos((creditosData as any[]) || []);
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

  async function editarCredito(c: Credito) {
    const valorAtual = moneyBR(c.valor).replace("R$", "").trim();

    const novoValorTexto = window.prompt("Novo valor do crédito:", valorAtual);
    if (novoValorTexto === null) return;

    const novoValor = parseMoneyBR(novoValorTexto);
    if (!novoValor || novoValor <= 0) {
      setMsg("Valor inválido.");
      return;
    }

    const novaObra = window.prompt("Obra:", c.obra || "");
    if (novaObra === null) return;

    const novaObs = window.prompt("Observação:", c.observacao || "");
    if (novaObs === null) return;

    const { error } = await supabase
      .from("adiantamento_creditos")
      .update({
        valor: novoValor,
        obra: novaObra.trim() || null,
        observacao: novaObs.trim() || null,
      })
      .eq("id", c.id);

    if (error) {
      setMsg(`Erro: ${error.message}`);
      return;
    }

    setMsg("Crédito editado.");
    await carregar();
  }

  async function excluirCredito(c: Credito) {
    const ok = window.confirm(
      `Excluir crédito de ${moneyBR(c.valor)} para ${c.funcionario?.nome || "colaborador"}?`
    );

    if (!ok) return;

    const { error } = await supabase
      .from("adiantamento_creditos")
      .delete()
      .eq("id", c.id);

    if (error) {
      setMsg(`Erro: ${error.message}`);
      return;
    }

    setMsg("Crédito excluído.");
    await carregar();
  }

  async function editarGasto(g: Gasto) {
    const valorAtual = moneyBR(g.valor).replace("R$", "").trim();

    const novoValorTexto = window.prompt("Novo valor do gasto:", valorAtual);
    if (novoValorTexto === null) return;

    const novoValor = parseMoneyBR(novoValorTexto);
    if (!novoValor || novoValor <= 0) {
      setMsg("Valor inválido.");
      return;
    }

    const novaCategoria = window.prompt("Categoria:", g.categoria || "");
    if (novaCategoria === null) return;

    const novaDescricao = window.prompt("Descrição:", g.descricao || "");
    if (novaDescricao === null) return;

    if (!novaDescricao.trim()) {
      setMsg("Descrição obrigatória.");
      return;
    }

    const { error } = await supabase
      .from("adiantamento_gastos")
      .update({
        valor: novoValor,
        categoria: novaCategoria.trim() || g.categoria,
        descricao: novaDescricao.trim(),
      })
      .eq("id", g.id);

    if (error) {
      setMsg(`Erro: ${error.message}`);
      return;
    }

    setMsg("Gasto editado.");
    await carregar();
  }

  async function excluirGasto(g: Gasto) {
    const ok = window.confirm(
      `Excluir gasto de ${moneyBR(g.valor)} de ${g.funcionario?.nome || "colaborador"}?`
    );

    if (!ok) return;

    const { error } = await supabase
      .from("adiantamento_gastos")
      .delete()
      .eq("id", g.id);

    if (error) {
      setMsg(`Erro: ${error.message}`);
      return;
    }

    setMsg("Gasto excluído.");
    await carregar();
  }

  async function gerarExtratoContabil() {
    const funcionarioSelecionado = filtroFuncionario || funcionarioId;

    if (!funcionarioSelecionado) {
      alert("Selecione um colaborador.");
      return;
    }

    const saldo = saldos.find((s) => s.funcionario_id === funcionarioSelecionado);

    if (!saldo) {
      alert("Colaborador não encontrado.");
      return;
    }

    const { data, error } = await supabase
      .from("adiantamento_extrato_v")
      .select("*")
      .eq("funcionario_id", funcionarioSelecionado)
      .order("created_at", { ascending: true });

    if (error) {
      alert("Erro ao gerar extrato: " + error.message);
      return;
    }

    const movimentos = data || [];
    let saldoAcumulado = 0;
    let contadorComprovante = 0;

    const linhas = movimentos
      .map((m: any) => {
        const valor = Number(m.valor || 0);
        saldoAcumulado += valor;

        const isCredito = m.tipo === "CREDITO";
        const valorAbs = Math.abs(valor);

        if (m.foto_url) contadorComprovante += 1;

        return `
          <tbody class="movimento">
            <tr>
              <td>${dateBR(m.created_at)}</td>
              <td>${isCredito ? "CRÉDITO" : "DÉBITO"}</td>
              <td>${m.descricao || "-"}</td>
              <td>${m.obra || "-"}</td>
              <td class="${isCredito ? "credito" : "debito"}">${moneyBR(valorAbs)}</td>
              <td>${moneyBR(saldoAcumulado)}</td>
            </tr>

            ${
              m.foto_url
                ? `
                  <tr>
                    <td colspan="6" class="fotoLinha">
                      <div class="comprovanteBox">
                        <div class="comprovanteTitulo">
                          Comprovante ${String(contadorComprovante).padStart(2, "0")} — ${
                            m.descricao || m.categoria || "Despesa"
                          } — ${moneyBR(valorAbs)}
                        </div>
                        <img src="${m.foto_url}" />
                      </div>
                    </td>
                  </tr>
                `
                : ""
            }
          </tbody>
        `;
      })
      .join("");

    const janela = window.open("", "_blank");

    if (!janela) return;

    janela.document.write(`
      <html>
        <head>
          <title>Extrato - ${saldo.funcionario}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 28px;
              color: #111827;
            }

            h1 {
              margin: 0;
              font-size: 24px;
            }

            .sub {
              margin-top: 4px;
              color: #6b7280;
              font-size: 13px;
            }

            .dados {
              margin-top: 18px;
              font-size: 13px;
              line-height: 1.6;
            }

            .box {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 12px;
              margin: 22px 0;
            }

            .card {
              border: 1px solid #d1d5db;
              border-radius: 12px;
              padding: 14px;
              break-inside: avoid;
            }

            .card span {
              display: block;
              color: #6b7280;
              font-size: 11px;
              font-weight: bold;
              margin-bottom: 6px;
              text-transform: uppercase;
            }

            .card strong {
              font-size: 19px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
              font-size: 11px;
            }

            th {
              background: #111827;
              color: white;
              text-align: left;
              padding: 8px;
            }

            td {
              border: 1px solid #d1d5db;
              padding: 7px;
              vertical-align: top;
            }

            .movimento {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .credito {
              color: #166534;
              font-weight: bold;
              white-space: nowrap;
            }

            .debito {
              color: #991b1b;
              font-weight: bold;
              white-space: nowrap;
            }

            .fotoLinha {
              background: #f9fafb;
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .comprovanteBox {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .comprovanteTitulo {
              font-weight: bold;
              margin-bottom: 8px;
              color: #374151;
            }

            img {
              max-width: 220px;
              max-height: 220px;
              margin-top: 4px;
              border: 1px solid #d1d5db;
              border-radius: 8px;
              display: block;
            }

            .assinatura {
              margin-top: 54px;
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 60px;
              break-inside: avoid;
              page-break-inside: avoid;
            }

            .linha {
              border-top: 1px solid #111827;
              text-align: center;
              padding-top: 8px;
              font-size: 12px;
            }

            @media print {
              body {
                padding: 18px;
              }

              .assinatura {
                page-break-inside: avoid;
              }
            }
          </style>
        </head>

        <body>
          <h1>Extrato de Adiantamento</h1>
          <div class="sub">Prestação de contas - GP Asfalto</div>

          <div class="dados">
            <div><strong>Colaborador:</strong> ${saldo.funcionario}</div>
            <div><strong>Emitido em:</strong> ${new Date().toLocaleString("pt-BR")}</div>
          </div>

          <div class="box">
            <div class="card">
              <span>Valor adiantado</span>
              <strong>${moneyBR(saldo.total_credito)}</strong>
            </div>

            <div class="card">
              <span>Valor comprovado</span>
              <strong>${moneyBR(saldo.total_gasto)}</strong>
            </div>

            <div class="card">
              <span>Saldo a devolver</span>
              <strong>${moneyBR(saldo.saldo)}</strong>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Obra</th>
                <th>Valor</th>
                <th>Saldo</th>
              </tr>
            </thead>

            ${linhas || `<tbody><tr><td colspan="6">Nenhum lançamento encontrado.</td></tr></tbody>`}
          </table>

          <div class="assinatura">
            <div class="linha">Colaborador</div>
            <div class="linha">Conferência / Administração</div>
          </div>

          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 600);
            };
          </script>
        </body>
      </html>
    `);

    janela.document.close();
  }

  return (
    <main className="page">
      <div className="header">
        <div>
          <p className="eyebrow">GP Asfalto</p>
          <h1>Adiantamentos</h1>
        </div>

        <button className="printBtn" onClick={gerarExtratoContabil}>
          Extrato
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
          <h2>Créditos lançados</h2>
        </div>

        <div className="lancamentos">
          {creditosFiltrados.map((c) => (
            <div key={c.id} className="linhaLancamento">
              <div>
                <strong>{c.funcionario?.nome || "Colaborador"}</strong>
                <small>{dateBR(c.created_at)}</small>
                <div className="desc">
                  {c.obra || "-"} · {c.observacao || "Crédito"}
                </div>
              </div>

              <div className="ladoValor">
                <span className="valorCredito">{moneyBR(c.valor)}</span>
                <div className="actions">
                  <button onClick={() => editarCredito(c)}>Editar</button>
                  <button onClick={() => excluirCredito(c)}>Excluir</button>
                </div>
              </div>
            </div>
          ))}

          {creditosFiltrados.length === 0 && (
            <div className="empty">Nenhum crédito encontrado.</div>
          )}
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

                  <button onClick={() => editarGasto(g)}>Editar</button>
                  <button onClick={() => excluirGasto(g)}>Excluir</button>

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

        .lancamentos {
          display: grid;
          gap: 10px;
        }

        .linhaLancamento {
          border: 1px solid #e5e7eb;
          border-radius: 16px;
          padding: 14px;
          display: flex;
          justify-content: space-between;
          gap: 14px;
          background: #fff;
        }

        .linhaLancamento strong {
          display: block;
          font-size: 15px;
        }

        .linhaLancamento small {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        .ladoValor {
          text-align: right;
          min-width: 150px;
        }

        .valorCredito {
          display: block;
          font-weight: 900;
          color: #166534;
          font-size: 17px;
          margin-bottom: 8px;
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
          justify-content: flex-end;
        }

        .gastoInfo .actions {
          justify-content: flex-start;
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

          .linhaLancamento {
            display: block;
          }

          .ladoValor {
            text-align: left;
            margin-top: 10px;
          }

          .actions {
            justify-content: flex-start;
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

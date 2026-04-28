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
  saldo: number;
  total_credito: number;
  total_gasto: number;
  gastos_pendentes: number;
};

function moneyBR(value: number | string | null | undefined) {
  const n = Number(value || 0);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
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
  const cents = Number(digits) / 100;
  return cents.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function LancarAdiantamentoFuncionarioPage() {
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);

  const [funcionarioId, setFuncionarioId] = useState("");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const saldoAtual = useMemo(() => {
    return saldos.find((s) => s.funcionario_id === funcionarioId);
  }, [saldos, funcionarioId]);

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (!foto) {
      setPreview("");
      return;
    }

    const url = URL.createObjectURL(foto);
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [foto]);

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

    setFuncionarios(funcionariosData || []);
    setSaldos(saldosData || []);
  }

  async function uploadFoto() {
    if (!foto) return null;

    const ext = foto.name.split(".").pop() || "jpg";
    const fileName = `${funcionarioId}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("adiantamentos")
      .upload(fileName, foto, {
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      throw new Error(error.message);
    }

    const { data } = supabase.storage
      .from("adiantamentos")
      .getPublicUrl(fileName);

    return {
      path: fileName,
      url: data.publicUrl,
    };
  }

  async function salvar() {
    setMsg("");

    const valorNumber = parseMoneyBR(valor);

    if (!funcionarioId) {
      setMsg("Selecione seu nome.");
      return;
    }

    if (!foto) {
      setMsg("Tire a foto do comprovante.");
      return;
    }

    if (!valorNumber || valorNumber <= 0) {
      setMsg("Informe o valor do gasto.");
      return;
    }

    if (!descricao.trim()) {
      setMsg("Descreva rapidamente o gasto.");
      return;
    }

    try {
      setLoading(true);

      const uploaded = await uploadFoto();

      const { error } = await supabase.from("adiantamento_gastos").insert({
        funcionario_id: funcionarioId,
        valor: valorNumber,
        descricao: descricao.trim(),
        categoria: "OUTROS",
        foto_url: uploaded?.url,
        foto_path: uploaded?.path,
      });

      if (error) throw new Error(error.message);

      setValor("");
      setDescricao("");
      setFoto(null);
      setPreview("");
      setMsg("Gasto enviado com sucesso.");

      await carregar();
    } catch (e: any) {
      setMsg(`Erro: ${e.message || "não foi possível salvar"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="card">
        <div className="top">
          <div>
            <p className="eyebrow">GP Asfalto</p>
            <h1>Enviar gasto</h1>
          </div>
          <div className="badge">Celular</div>
        </div>

        <label className="label">Quem está lançando?</label>
        <select
          className="input"
          value={funcionarioId}
          onChange={(e) => setFuncionarioId(e.target.value)}
        >
          <option value="">Selecione seu nome</option>
          {funcionarios.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>

        <div className="saldoBox">
          <span>Saldo disponível</span>
          <strong>{moneyBR(saldoAtual?.saldo || 0)}</strong>
        </div>

        <label className="photoBox">
          {preview ? (
            <img src={preview} alt="Foto do comprovante" />
          ) : (
            <div>
              <div className="cameraIcon">📷</div>
              <strong>Tirar foto do comprovante</strong>
              <small>Recibo, cupom, anotação ou comprovante</small>
            </div>
          )}

          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFoto(e.target.files?.[0] || null)}
          />
        </label>

        <label className="label">Valor gasto</label>
        <input
          className="input big"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(formatMoneyInput(e.target.value))}
        />

        <label className="label">Descrição</label>
        <textarea
          className="textarea"
          placeholder="Ex: almoço, lanche, estacionamento, peça urgente..."
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
        />

        {msg && <div className="msg">{msg}</div>}

        <button className="btn" onClick={salvar} disabled={loading}>
          {loading ? "Enviando..." : "Enviar gasto"}
        </button>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f3f5f8;
          padding: 16px;
          font-family: Arial, sans-serif;
          color: #111827;
        }

        .card {
          max-width: 520px;
          margin: 0 auto;
          background: white;
          border-radius: 24px;
          padding: 20px;
          box-shadow: 0 12px 35px rgba(15, 23, 42, 0.12);
        }

        .top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 20px;
        }

        .eyebrow {
          margin: 0 0 4px;
          font-size: 13px;
          color: #6b7280;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1;
        }

        .badge {
          background: #eef2ff;
          color: #1e3a8a;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 13px;
          font-weight: 800;
        }

        .label {
          display: block;
          margin: 18px 0 8px;
          font-size: 14px;
          font-weight: 800;
          color: #374151;
        }

        .input,
        .textarea {
          width: 100%;
          border: 1px solid #d1d5db;
          border-radius: 16px;
          padding: 15px;
          font-size: 17px;
          outline: none;
          background: #fff;
        }

        .input:focus,
        .textarea:focus {
          border-color: #111827;
        }

        .input.big {
          font-size: 30px;
          font-weight: 900;
          text-align: center;
        }

        .textarea {
          min-height: 96px;
          resize: none;
        }

        .saldoBox {
          margin-top: 16px;
          padding: 18px;
          border-radius: 20px;
          background: #111827;
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .saldoBox span {
          font-size: 14px;
          color: #d1d5db;
        }

        .saldoBox strong {
          font-size: 26px;
        }

        .photoBox {
          margin-top: 18px;
          min-height: 230px;
          border: 2px dashed #9ca3af;
          border-radius: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          overflow: hidden;
          background: #f9fafb;
          cursor: pointer;
        }

        .photoBox input {
          display: none;
        }

        .photoBox img {
          width: 100%;
          height: 260px;
          object-fit: cover;
          display: block;
        }

        .cameraIcon {
          font-size: 52px;
          margin-bottom: 10px;
        }

        .photoBox strong {
          display: block;
          font-size: 19px;
        }

        .photoBox small {
          display: block;
          margin-top: 6px;
          color: #6b7280;
        }

        .btn {
          width: 100%;
          border: 0;
          border-radius: 18px;
          padding: 18px;
          margin-top: 18px;
          font-size: 20px;
          font-weight: 900;
          color: white;
          background: #16a34a;
          cursor: pointer;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .msg {
          margin-top: 16px;
          padding: 14px;
          border-radius: 14px;
          background: #fff7ed;
          color: #9a3412;
          font-weight: 700;
          font-size: 14px;
        }

        @media (max-width: 480px) {
          .page {
            padding: 10px;
          }

          .card {
            border-radius: 20px;
            padding: 16px;
          }

          h1 {
            font-size: 28px;
          }

          .saldoBox {
            display: block;
          }

          .saldoBox strong {
            display: block;
            margin-top: 6px;
          }
        }
      `}</style>
    </main>
  );
}

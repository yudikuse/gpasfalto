"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Funcionario = { id: string; nome: string };
type Saldo = { funcionario_id: string; funcionario: string; saldo: number };

type Extrato = {
  id: string;
  created_at: string;
  tipo: "CREDITO" | "GASTO";
  valor: number;
  descricao: string | null;
  categoria: string | null;
};

const CATEGORIAS = [
  "Almoço",
  "Janta",
  "Café da manhã",
  "Abastecimento",
  "Borracharia",
  "Pedágio",
  "Outros",
];

const MAX_UPLOAD_MB = 8;
const MAX_IMAGE_WIDTH = 1600;
const JPEG_QUALITY = 0.75;

function moneyBR(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function dateBR(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

function parseMoneyBR(value: string) {
  const clean = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
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

async function compressImage(file: File): Promise<File> {
  const imageBitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_WIDTH / imageBitmap.width);
  const width = Math.round(imageBitmap.width * scale);
  const height = Math.round(imageBitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(imageBitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY);
  });

  if (!blob) return file;

  return new File([blob], "comprovante.jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function LancarContent() {
  const searchParams = useSearchParams();
  const funcionarioParam = searchParams.get("f");
  const isLocked = !!funcionarioParam;

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [extrato, setExtrato] = useState<Extrato[]>([]);

  const [funcionarioId, setFuncionarioId] = useState("");
  const [categoria, setCategoria] = useState("Almoço");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [foto, setFoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const funcionarioAtual = useMemo(() => {
    return funcionarios.find((f) => f.id === funcionarioId);
  }, [funcionarios, funcionarioId]);

  const saldoAtual = useMemo(() => {
    return saldos.find((s) => s.funcionario_id === funcionarioId);
  }, [saldos, funcionarioId]);

  useEffect(() => {
    carregar();
  }, []);

  useEffect(() => {
    if (funcionarioParam) setFuncionarioId(funcionarioParam);
  }, [funcionarioParam]);

  useEffect(() => {
    if (funcionarioId) carregarExtrato(funcionarioId);
    else setExtrato([]);
  }, [funcionarioId]);

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
      .select("funcionario_id,funcionario,saldo")
      .eq("ativo", true)
      .order("funcionario", { ascending: true });

    setFuncionarios(funcionariosData || []);
    setSaldos(saldosData || []);
  }

  async function carregarExtrato(id: string) {
    const { data } = await supabase
      .from("adiantamento_extrato_v")
      .select("id,created_at,tipo,valor,descricao,categoria")
      .eq("funcionario_id", id)
      .order("created_at", { ascending: false })
      .limit(20);

    setExtrato((data as Extrato[]) || []);
  }

  async function uploadFoto() {
    if (!foto) return null;

    const originalMb = foto.size / 1024 / 1024;
    let finalFile = foto;

    if (originalMb > MAX_UPLOAD_MB || foto.type !== "image/jpeg") {
      setMsg("Comprimindo foto...");
      finalFile = await compressImage(foto);
    }

    const fileName = `${funcionarioId}/${Date.now()}.jpg`;

    const { error } = await supabase.storage
      .from("adiantamentos")
      .upload(fileName, finalFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: "image/jpeg",
      });

    if (error) throw new Error(error.message);

    const { data } = supabase.storage
      .from("adiantamentos")
      .getPublicUrl(fileName);

    return { path: fileName, url: data.publicUrl };
  }

  async function salvar() {
    setMsg("");

    const valorNumber = parseMoneyBR(valor);
    const descricaoFinal = categoria === "Outros" ? descricao.trim() : categoria;

    if (!funcionarioId) return setMsg("Colaborador não selecionado.");
    if (!foto) return setMsg("Tire a foto do comprovante.");
    if (!valorNumber || valorNumber <= 0) return setMsg("Informe o valor do gasto.");
    if (!descricaoFinal) return setMsg("Descreva o gasto.");

    try {
      setLoading(true);

      const uploaded = await uploadFoto();

      const { error } = await supabase.from("adiantamento_gastos").insert({
        funcionario_id: funcionarioId,
        valor: valorNumber,
        categoria,
        descricao: descricaoFinal,
        foto_url: uploaded?.url,
        foto_path: uploaded?.path,
      });

      if (error) throw new Error(error.message);

      setCategoria("Almoço");
      setDescricao("");
      setValor("");
      setFoto(null);
      setPreview("");
      setMsg("Comprovante enviado com sucesso.");

      await carregar();
      await carregarExtrato(funcionarioId);
    } catch (e: any) {
      setMsg(`Erro: ${e.message || "não foi possível salvar"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <div className="card">
        <p className="eyebrow">GP Asfalto</p>
        <h1>Comprovante de Despesas</h1>

        <label className="label">Colaborador</label>

        {isLocked ? (
          <div className="lockedName">
            <strong>{funcionarioAtual?.nome || "Carregando..."}</strong>
          </div>
        ) : (
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
        )}

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
              <strong>Tirar foto</strong>
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

        <label className="label">Valor</label>
        <input
          className="input big"
          inputMode="numeric"
          placeholder="0,00"
          value={valor}
          onChange={(e) => setValor(formatMoneyInput(e.target.value))}
        />

        <label className="label">Tipo de gasto</label>
        <div className="chips">
          {CATEGORIAS.map((cat) => (
            <button
              key={cat}
              type="button"
              className={categoria === cat ? "chip active" : "chip"}
              onClick={() => setCategoria(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {categoria === "Outros" && (
          <>
            <label className="label">Descrição</label>
            <textarea
              className="textarea"
              placeholder="Descreva o gasto"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </>
        )}

        {msg && <div className="msg">{msg}</div>}

        <button className="btn" onClick={salvar} disabled={loading}>
          {loading ? "Enviando..." : "Enviar Comprovante"}
        </button>

        <div className="extratoBox">
          <h2>Extrato simples</h2>

          {extrato.length === 0 ? (
            <p className="empty">Nenhum lançamento ainda.</p>
          ) : (
            extrato.map((item) => {
              const isCredito = item.tipo === "CREDITO";
              return (
                <div key={`${item.tipo}-${item.id}`} className="extratoItem">
                  <div>
                    <strong>{isCredito ? "Crédito" : item.descricao}</strong>
                    <small>{dateBR(item.created_at)}</small>
                  </div>

                  <span className={isCredito ? "valor credito" : "valor debito"}>
                    {isCredito ? "+" : "-"} {moneyBR(Math.abs(Number(item.valor || 0)))}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f3f5f8;
          padding: 12px;
          font-family: Arial, sans-serif;
          color: #111827;
        }

        .card {
          max-width: 520px;
          margin: 0 auto;
          background: white;
          border-radius: 24px;
          padding: 18px;
          box-shadow: 0 12px 35px rgba(15, 23, 42, 0.12);
        }

        .eyebrow {
          margin: 0 0 4px;
          font-size: 13px;
          color: #6b7280;
          font-weight: 800;
          text-transform: uppercase;
        }

        h1 {
          margin: 0 0 18px;
          font-size: 30px;
        }

        .label {
          display: block;
          margin: 16px 0 8px;
          font-size: 14px;
          font-weight: 900;
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
          background: white;
        }

        .input.big {
          font-size: 32px;
          font-weight: 900;
          text-align: center;
        }

        .textarea {
          min-height: 90px;
          resize: none;
        }

        .lockedName {
          border: 1px solid #d1d5db;
          border-radius: 16px;
          padding: 15px;
          background: #f9fafb;
        }

        .lockedName strong {
          display: block;
          font-size: 18px;
        }

        .saldoBox {
          margin-top: 14px;
          padding: 16px;
          border-radius: 20px;
          background: #111827;
          color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .saldoBox span {
          font-size: 14px;
          color: #d1d5db;
        }

        .saldoBox strong {
          font-size: 25px;
        }

        .photoBox {
          margin-top: 18px;
          min-height: 220px;
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
          font-size: 54px;
          margin-bottom: 8px;
        }

        .photoBox strong {
          display: block;
          font-size: 21px;
        }

        .photoBox small {
          display: block;
          margin-top: 5px;
          color: #6b7280;
        }

        .chips {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .chip {
          border: 1px solid #d1d5db;
          border-radius: 16px;
          padding: 15px 10px;
          background: #f9fafb;
          font-size: 16px;
          font-weight: 900;
          color: #111827;
        }

        .chip.active {
          background: #111827;
          color: white;
          border-color: #111827;
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
        }

        .msg {
          margin-top: 16px;
          padding: 14px;
          border-radius: 14px;
          background: #fff7ed;
          color: #9a3412;
          font-weight: 800;
          font-size: 14px;
        }

        .extratoBox {
          margin-top: 24px;
          padding-top: 18px;
          border-top: 1px solid #e5e7eb;
        }

        .extratoBox h2 {
          margin: 0 0 12px;
          font-size: 20px;
        }

        .extratoItem {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 0;
          border-bottom: 1px solid #f1f5f9;
        }

        .extratoItem strong {
          display: block;
          font-size: 14px;
        }

        .extratoItem small {
          display: block;
          margin-top: 3px;
          color: #6b7280;
          font-size: 12px;
          font-weight: 700;
        }

        .valor {
          font-weight: 900;
          white-space: nowrap;
        }

        .valor.credito {
          color: #166534;
        }

        .valor.debito {
          color: #991b1b;
        }

        .empty {
          color: #6b7280;
          font-weight: 800;
          font-size: 14px;
        }
      `}</style>
    </main>
  );
}

export default function LancarPage() {
  return (
    <Suspense fallback={<main style={{ padding: 20 }}>Carregando...</main>}>
      <LancarContent />
    </Suspense>
  );
}

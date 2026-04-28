"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function Page() {
  const [funcionarios, setFuncionarios] = useState<any[]>([]);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saldo, setSaldo] = useState<any[]>([]);
  const [tipo, setTipo] = useState<"credito" | "gasto">("gasto");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data: f } = await supabase.from("funcionarios").select("*");
    setFuncionarios(f || []);

    const { data: s } = await supabase.from("saldo_funcionarios").select("*");
    setSaldo(s || []);
  }

  async function uploadFoto() {
    if (!file) return null;

    const path = `${Date.now()}-${file.name}`;

    const { error } = await supabase.storage
      .from("adiantamentos")
      .upload(path, file);

    if (error) {
      alert("Erro upload");
      return null;
    }

    const { data } = supabase.storage
      .from("adiantamentos")
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async function salvar() {
    if (!funcionarioId || !valor) return alert("Preencha tudo");

    if (tipo === "credito") {
      await supabase.from("adiantamentos").insert({
        funcionario_id: funcionarioId,
        valor: Number(valor),
        criado_por: "encarregado",
      });
    } else {
      if (!file) return alert("Foto obrigatória");

      const foto = await uploadFoto();

      await supabase.from("gastos").insert({
        funcionario_id: funcionarioId,
        valor: Number(valor),
        descricao,
        foto_url: foto,
      });
    }

    setValor("");
    setDescricao("");
    setFile(null);

    load();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Adiantamentos</h1>

      <div style={{ marginBottom: 20 }}>
        <select
          value={funcionarioId}
          onChange={(e) => setFuncionarioId(e.target.value)}
        >
          <option value="">Selecione funcionário</option>
          {funcionarios.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 20 }}>
        <button onClick={() => setTipo("gasto")}>Gasto</button>
        <button onClick={() => setTipo("credito")}>Crédito</button>
      </div>

      <input
        placeholder="Valor"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
      />

      {tipo === "gasto" && (
        <>
          <input
            placeholder="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />

          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </>
      )}

      <div style={{ marginTop: 20 }}>
        <button onClick={salvar}>Salvar</button>
      </div>

      <hr />

      <h2>Saldos</h2>

      {saldo.map((s) => (
        <div
          key={s.id}
          style={{
            border: "1px solid #ccc",
            padding: 10,
            marginBottom: 10,
          }}
        >
          <strong>{s.nome}</strong>
          <div>Crédito: R$ {s.total_credito}</div>
          <div>Gasto: R$ {s.total_gasto}</div>
          <div>Saldo: R$ {s.saldo}</div>
        </div>
      ))}

      <button onClick={() => window.print()}>Gerar PDF</button>
    </div>
  );
}

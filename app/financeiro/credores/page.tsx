// FILE: app/financeiro/credores/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabaseClient";

export type Credor = { codigo: number; nome: string; nome_norm: string; };

export function normalizar(s: string) {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function matchCredor(nome: string, credores: Credor[]): Credor | null {
  if (!credores.length || !nome) return null;
  const norm  = normalizar(nome);
  const exact = credores.find(c => c.nome_norm === norm);
  if (exact) return exact;
  const palavras = norm.split(" ").filter(p => p.length > 3);
  let melhor: { credor: Credor; score: number } | null = null;
  for (const c of credores) {
    const score = palavras.filter(p => c.nome_norm.includes(p)).length;
    if (score > 0 && (!melhor || score > melhor.score)) melhor = { credor: c, score };
  }
  return melhor?.credor ?? null;
}

export async function buscarTodosCredores(): Promise<Credor[]> {
  const { data, error } = await supabase.from("credores_sienge").select("codigo,nome,nome_norm").order("nome");
  if (error) throw error;
  return data ?? [];
}

export async function upsertCredores(credores: { codigo: number; nome: string }[]) {
  const rows = credores.map(c => ({ codigo: c.codigo, nome: c.nome, nome_norm: normalizar(c.nome) }));
  const { error } = await supabase.from("credores_sienge").upsert(rows, { onConflict: "codigo" });
  if (error) throw error;
}

const C = {
  bg:"#f4f5f7",surface:"#ffffff",border:"#e8eaed",borderMid:"#d1d5db",
  text:"#1a1f36",textMid:"#4b5563",textMute:"#9ca3af",
  primary:"#4361ee",primaryBg:"#eef1fd",accent:"#ff4b2b",
  success:"#0d9f6e",successBg:"#ecfdf5",danger:"#dc2626",dangerBg:"#fef2f2",
};
const inp:React.CSSProperties={height:34,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surface,outline:"none",fontFamily:"inherit"};
const thS:React.CSSProperties={padding:"10px 12px",textAlign:"left" as any,fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase" as any,letterSpacing:"0.05em"};
const tdS:React.CSSProperties={padding:"8px 12px",verticalAlign:"middle" as any};
const lbl:React.CSSProperties={fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase" as any,letterSpacing:"0.06em",marginBottom:4};

function Card({children,style}:{children:React.ReactNode;style?:React.CSSProperties}){
  return <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",...style}}>{children}</div>;
}
function CardHeader({title,sub,right}:{title:string;sub?:string;right?:React.ReactNode}){
  return <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
    <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{title}</div>{sub&&<div style={{fontSize:12,color:C.textMute,marginTop:2}}>{sub}</div>}</div>
    {right}
  </div>;
}
function Btn({children,onClick,disabled,variant="default",style}:{children:React.ReactNode;onClick?:()=>void;disabled?:boolean;variant?:string;style?:React.CSSProperties}){
  const vs:Record<string,React.CSSProperties>={
    default:{background:C.surface,color:C.textMid,border:`1px solid ${C.border}`},
    primary:{background:C.primary,color:"#fff",border:"none"},
    success:{background:C.success,color:"#fff",border:"none"},
    ghost:{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`},
    danger:{background:C.dangerBg,color:C.danger,border:`1px solid ${C.danger}`},
  };
  return <button type="button" onClick={onClick} disabled={disabled} style={{height:34,padding:"0 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,display:"inline-flex",alignItems:"center",gap:6,fontFamily:"inherit",...(vs[variant]??vs.default),...style}}>{children}</button>;
}

export default function CreditoresPage() {
  const [credores,setCredores] = useState<Credor[]>([]);
  const [loading,setLoading]   = useState(true);
  const [busca,setBusca]       = useState("");
  const [upando,setUpando]     = useState(false);
  const [dragOver,setDragOver] = useState(false);
  const [msgOk,setMsgOk]       = useState("");
  const [msgErro,setMsgErro]   = useState("");
  const [editando,setEditando] = useState<number|null>(null);
  const [editNome,setEditNome] = useState("");
  const [novoNome,setNovoNome] = useState("");
  const [novoCod,setNovoCod]   = useState("");
  const [testeNome,setTesteNome]   = useState("");
  const [testeResult,setTesteResult] = useState<Credor|null|undefined>(undefined);
  const fileRef = useRef<HTMLInputElement>(null);

  const ok = (m:string)=>{setMsgOk(m);setTimeout(()=>setMsgOk(""),4000);};

  const carregar = useCallback(async()=>{
    setLoading(true);
    try{ setCredores(await buscarTodosCredores()); }
    catch(e:any){ setMsgErro("Erro ao carregar: "+e.message); }
    finally{ setLoading(false); }
  },[]);

  useEffect(()=>{ carregar(); },[carregar]);

  const processarPdf = async(file:File)=>{
    setUpando(true); setMsgErro(""); setMsgOk("");
    const fd=new FormData(); fd.append("pdf",file);
    try{
      const res=await fetch("/api/financeiro/credores-pdf",{method:"POST",body:fd});
      const data=await res.json();
      if(!data.ok){ setMsgErro(data.error??"Erro"); return; }
      await upsertCredores(data.credores);
      await carregar();
      ok(`✓ ${data.total} credores importados/atualizados no Supabase`);
    } catch(e:any){ setMsgErro("Falha: "+e.message); }
    finally{ setUpando(false); }
  };

  const adicionarManual = async()=>{
    const cod=parseInt(novoCod,10);
    if(!novoNome.trim()||!cod) return;
    try{
      await upsertCredores([{codigo:cod,nome:novoNome.trim()}]);
      await carregar(); setNovoNome(""); setNovoCod(""); ok("✓ Credor salvo");
    }catch(e:any){setMsgErro("Erro: "+e.message);}
  };

  const confirmarEdicao = async()=>{
    if(!editando) return;
    try{
      await upsertCredores([{codigo:editando,nome:editNome}]);
      await carregar(); setEditando(null); ok("✓ Nome atualizado");
    }catch(e:any){setMsgErro("Erro: "+e.message);}
  };

  const remover = async(cod:number)=>{
    if(!confirm(`Remover credor ${cod}?`)) return;
    try{
      const {error}=await supabase.from("credores_sienge").delete().eq("codigo",cod);
      if(error) throw error;
      await carregar(); ok("Credor removido");
    }catch(e:any){setMsgErro("Erro: "+e.message);}
  };

  const filtrados=credores.filter(c=>!busca||c.nome.toLowerCase().includes(busca.toLowerCase())||String(c.codigo).includes(busca));

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',-apple-system,sans-serif"}}>
      <header style={{height:56,background:C.surface,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 0 rgba(0,0,0,0.05)"}}>
        <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{height:36,objectFit:"contain"}}/>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:13,color:C.textMute}}>Financeiro /</span>
          <span style={{fontSize:14,fontWeight:600,color:C.text}}>Credores Sienge</span>
          <span style={{padding:"2px 8px",borderRadius:99,background:C.primaryBg,color:C.primary,fontSize:12,fontWeight:700}}>{credores.length}</span>
        </div>
        <Btn variant="ghost" onClick={carregar} style={{fontSize:12}}>⟳ Atualizar</Btn>
      </header>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"28px 20px",display:"flex",flexDirection:"column",gap:16}}>
        {msgOk   && <div style={{background:C.successBg,border:`1px solid ${C.success}`,borderRadius:8,padding:"10px 16px",fontSize:13,color:C.success}}>{msgOk}</div>}
        {msgErro && <div style={{background:C.dangerBg,border:`1px solid ${C.danger}`,borderRadius:8,padding:"10px 16px",fontSize:13,color:C.danger,display:"flex",justifyContent:"space-between"}}>
          <span>{msgErro}</span><span style={{cursor:"pointer"}} onClick={()=>setMsgErro("")}>×</span>
        </div>}

        <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:16,alignItems:"start"}}>

          {/* ESQUERDA */}
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <Card>
              <CardHeader title="Importar do PDF Contas Pagas" sub="A IA extrai todos os pares Nome → Código e salva no Supabase (upsert)"/>
              <div style={{padding:16}}>
                <div
                  onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)processarPdf(f);}}
                  onDragOver={e=>{e.preventDefault();setDragOver(true);}}
                  onDragLeave={()=>setDragOver(false)}
                  onClick={()=>fileRef.current?.click()}
                  style={{border:`2px dashed ${dragOver?C.primary:C.borderMid}`,borderRadius:8,padding:"20px 24px",cursor:"pointer",background:dragOver?C.primaryBg:C.bg,transition:"all .2s",display:"flex",alignItems:"center",gap:14}}
                >
                  <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)processarPdf(f);}}/>
                  <span style={{fontSize:32}}>{upando?"⏳":"📄"}</span>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:C.text}}>{upando?"Processando…":"Arraste o PDF ou clique para selecionar"}</div>
                    <div style={{fontSize:12,color:C.textMute,marginTop:2}}>Relatório <strong>Contas Pagas</strong> do Sienge · qualquer período · upsert automático</div>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Tabela de Credores"
                sub="Supabase · credores_sienge · compartilhada entre todos os usuários"
                right={<input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar…" style={{...inp,width:200}}/>}
              />
              {loading ? (
                <div style={{padding:32,textAlign:"center",color:C.textMute,fontSize:13}}>Carregando…</div>
              ) : credores.length===0 ? (
                <div style={{padding:32,textAlign:"center",color:C.textMute,fontSize:13}}>Nenhum credor. Importe um PDF de Contas Pagas para começar.</div>
              ) : (
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead><tr style={{background:C.bg,borderBottom:`1px solid ${C.border}`}}>
                      <th style={{...thS,width:90}}>Código</th>
                      <th style={thS}>Nome no Sienge</th>
                      <th style={{...thS,width:36}}></th>
                    </tr></thead>
                    <tbody>
                      {filtrados.map(c=>(
                        <tr key={c.codigo} style={{borderBottom:`1px solid ${C.border}`}}>
                          <td style={{...tdS,fontWeight:700,color:C.primary}}>{c.codigo}</td>
                          <td style={tdS}>
                            {editando===c.codigo?(
                              <div style={{display:"flex",gap:6}}>
                                <input value={editNome} onChange={e=>setEditNome(e.target.value)}
                                  onKeyDown={e=>{if(e.key==="Enter")confirmarEdicao();if(e.key==="Escape")setEditando(null);}}
                                  autoFocus style={{...inp,flex:1,height:28}}/>
                                <Btn variant="success" onClick={confirmarEdicao} style={{height:28,padding:"0 10px",fontSize:12}}>✓</Btn>
                                <Btn variant="ghost"   onClick={()=>setEditando(null)} style={{height:28,padding:"0 8px",fontSize:12}}>✕</Btn>
                              </div>
                            ):(
                              <span onClick={()=>{setEditando(c.codigo);setEditNome(c.nome);}} style={{cursor:"pointer",padding:"2px 4px",borderRadius:4,display:"inline-block"}} title="Clique para editar">{c.nome}</span>
                            )}
                          </td>
                          <td style={{...tdS,textAlign:"center" as any}}>
                            <button type="button" onClick={()=>remover(c.codigo)} style={{background:"none",border:"none",cursor:"pointer",color:C.textMute,fontSize:18,lineHeight:1}}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filtrados.length===0&&busca&&<div style={{padding:20,textAlign:"center",color:C.textMute,fontSize:12}}>Nenhum resultado para "{busca}"</div>}
                </div>
              )}
              {credores.length>0&&<div style={{padding:"10px 18px",borderTop:`1px solid ${C.border}`,fontSize:12,color:C.textMute,display:"flex",justifyContent:"space-between"}}>
                <span>{filtrados.length} de {credores.length} credores</span>
                <span>tabela: credores_sienge</span>
              </div>}
            </Card>
          </div>

          {/* DIREITA */}
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <Card>
              <CardHeader title="Adicionar manualmente"/>
              <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
                <div><div style={lbl}>Código Sienge *</div>
                  <input value={novoCod} onChange={e=>setNovoCod(e.target.value)} placeholder="Ex: 5197" style={{...inp,width:"100%",boxSizing:"border-box" as any}}/>
                </div>
                <div><div style={lbl}>Nome do Credor *</div>
                  <input value={novoNome} onChange={e=>setNovoNome(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")adicionarManual();}} placeholder="Ex: FETZ MINERADORA LTDA." style={{...inp,width:"100%",boxSizing:"border-box" as any}}/>
                </div>
                <Btn variant="primary" onClick={adicionarManual} disabled={!novoCod||!novoNome}>+ Adicionar</Btn>
              </div>
            </Card>

            <Card>
              <CardHeader title="Testar matching" sub="Simule como o OCR vai encontrar o credor"/>
              <div style={{padding:16,display:"flex",flexDirection:"column",gap:10}}>
                <div><div style={lbl}>Nome como viria da NF</div>
                  <input value={testeNome} onChange={e=>setTesteNome(e.target.value)} placeholder="Ex: INBRASUL TUBOS E CONEXOES" style={{...inp,width:"100%",boxSizing:"border-box" as any}}/>
                </div>
                <Btn variant="default" onClick={()=>setTesteResult(matchCredor(testeNome,credores))} disabled={!testeNome}>🔍 Testar</Btn>
                {testeResult!==undefined&&(
                  <div style={{padding:"10px 12px",borderRadius:8,background:testeResult?C.successBg:C.dangerBg,border:`1px solid ${testeResult?C.success:C.danger}`}}>
                    {testeResult?(
                      <><div style={{fontSize:12,fontWeight:700,color:C.success}}>✓ Match encontrado</div>
                      <div style={{fontSize:13,color:C.text,marginTop:4}}>{testeResult.nome}</div>
                      <div style={{fontSize:13,fontWeight:700,color:C.success,marginTop:2}}>Código: {testeResult.codigo}</div></>
                    ):(
                      <><div style={{fontSize:12,fontWeight:700,color:C.danger}}>✗ Sem correspondência</div>
                      <div style={{fontSize:12,color:C.textMid,marginTop:4}}>Adicione manualmente ou importe mais PDFs.</div></>
                    )}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <div style={{padding:16}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:8}}>💡 Como funciona</div>
                <div style={{fontSize:12,color:C.textMid,lineHeight:1.7}}>
                  O OCR lê o nome do fornecedor na NF e compara com esta tabela por palavras-chave normalizadas.<br/><br/>
                  <strong>"FETZ MINERADORA LTDA."</strong> no OCR → encontra código <strong>5197</strong> automaticamente.
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

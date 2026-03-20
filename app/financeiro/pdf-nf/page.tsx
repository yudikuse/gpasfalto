// FILE: app/financeiro/pdf-nf/page.tsx
"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { matchCredor, buscarTodosCredores, upsertCredores, normalizar, type Credor } from "@/app/financeiro/credores/page";

const SIENGE_BASE   = `/api/financeiro`; // proxy server-side — sem CORS

const C = {
  bg:"#f4f5f7",surface:"#ffffff",border:"#e8eaed",borderMid:"#d1d5db",
  text:"#1a1f36",textMid:"#4b5563",textMute:"#9ca3af",
  primary:"#4361ee",primaryBg:"#eef1fd",accent:"#ff4b2b",
  success:"#0d9f6e",successBg:"#ecfdf5",danger:"#dc2626",dangerBg:"#fef2f2",
};

type NfStatus = "pendente"|"enviando"|"ok"|"erro";
type PageStep  = "upload"|"lendo"|"revisao"|"enviando"|"concluido";
type Nf = {
  _id:string; _status:NfStatus; _erro:string|null; _siengeId:string|null;
  _creditorId:string; _selected:boolean; _creditorName:string;
  pagina:number; tipo_nota:string; numero_nf:string; serie:string;
  chave_acesso:string; fornecedor:string; cnpj_fornecedor:string;
  destinatario:string; data_emissao:string; data_vencimento:string;
  valor_total:string; descricao:string; condicao_pagamento:string;
};

function parseBRL(val:string):number{ return parseFloat(String(val??"").replace(/[R$\s]/g,"").replace(/\./g,"").replace(",","."))||0; }
function fmtDate(d:string):string|null{ if(!d)return null; const m=d.match(/(\d{2})\/(\d{2})\/(\d{4})/); if(m)return`${m[3]}-${m[2]}-${m[1]}`; if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d; return null; }
function statusColor(s:NfStatus){ return s==="ok"?C.success:s==="erro"?C.danger:s==="enviando"?C.primary:C.textMute; }
function statusBg(s:NfStatus){ return s==="ok"?C.successBg:s==="erro"?C.dangerBg:s==="enviando"?C.primaryBg:"#f3f4f6"; }
function statusLabel(s:NfStatus){ return s==="ok"?"✓ Enviada":s==="erro"?"✗ Erro":s==="enviando"?"⟳ Enviando…":"Pendente"; }

function Card({children,style}:{children:React.ReactNode;style?:CSSProperties}){
  return <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",...style}}>{children}</div>;
}
function CardHeader({title,sub,right}:{title:string;sub?:string;right?:React.ReactNode}){
  return <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
    <div><div style={{fontSize:14,fontWeight:600,color:C.text}}>{title}</div>{sub&&<div style={{fontSize:12,color:C.textMute,marginTop:2}}>{sub}</div>}</div>
    {right}
  </div>;
}
function Btn({children,onClick,disabled,variant="default",style}:{children:React.ReactNode;onClick?:()=>void;disabled?:boolean;variant?:string;style?:CSSProperties}){
  const vs:Record<string,CSSProperties>={
    default:{background:C.surface,color:C.textMid,border:`1px solid ${C.border}`},
    accent:{background:C.accent,color:"#fff",border:"none"},
    ghost:{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`},
  };
  return <button type="button" onClick={onClick} disabled={disabled} style={{height:34,padding:"0 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,display:"inline-flex",alignItems:"center",gap:6,fontFamily:"inherit",...(vs[variant]??vs.default),...style}}>{children}</button>;
}
function EditableCell({value,onChange,width}:{value:string;onChange:(v:string)=>void;width?:number}){
  return <input value={value??""} onChange={e=>onChange(e.target.value)} style={{width:width??140,height:28,padding:"0 8px",border:`1px solid ${C.border}`,borderRadius:6,fontSize:12,color:C.text,background:C.surface,outline:"none",fontFamily:"inherit"}}/>;
}

const th:CSSProperties={padding:"10px 10px",textAlign:"left" as any,fontSize:11,fontWeight:600,color:"#6b7280",textTransform:"uppercase" as any,letterSpacing:"0.05em",whiteSpace:"nowrap" as any};
const td:CSSProperties={padding:"8px 10px",verticalAlign:"middle" as any};

export default function PdfNfPage() {
  const [step,setStep]           = useState<PageStep>("upload");
  const [notas,setNotas]         = useState<Nf[]>([]);
  const [credores,setCredores]   = useState<Credor[]>([]);
  const [fileName,setFileName]   = useState("");
  const [erroLeitura,setErroLeitura] = useState("");
  const [progresso,setProgresso] = useState({atual:0,total:0});
  const [dragOver,setDragOver]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Carrega tabela de credores do Supabase ao montar
  useEffect(()=>{ buscarTodosCredores().then(setCredores).catch(console.error); },[]);

  const updNf = (id:string,key:keyof Nf,val:string) =>
    setNotas(ns=>ns.map(n=>n._id===id?{...n,[key]:val}:n));
  const toggleSel = (id:string) =>
    setNotas(ns=>ns.map(n=>n._id===id?{...n,_selected:!n._selected}:n));
  const toggleAll = (v:boolean) =>
    setNotas(ns=>ns.map(n=>n._status==="pendente"?{...n,_selected:v}:n));

  const selecionadas = notas.filter(n=>n._selected&&n._status==="pendente");
  const allSel = selecionadas.length===notas.filter(n=>n._status==="pendente").length&&notas.filter(n=>n._status==="pendente").length>0;

  const resumo = { total:notas.length, ok:notas.filter(n=>n._status==="ok").length, erro:notas.filter(n=>n._status==="erro").length };

  // Busca credor no Sienge pelo CNPJ.
  // Se achar → preenche o ID e salva no Supabase para próxima vez.
  // Retorna o id encontrado ou null.
  // Usa route server-side para evitar CORS
  const buscarCredorNaSienge = async(cnpj:string): Promise<{id:number;nome:string}|null>=>{
    const limpo=cnpj.replace(/\D/g,""); if(!limpo) return null;
    try{
      const r=await fetch(`/api/financeiro/buscar-credor?cnpj=${limpo}`);
      if(!r.ok) return null;
      const d=await r.json();
      if(!d.ok||!d.found) return null;
      const credor={id:d.id as number, nome:d.nome as string};
      // Salva no Supabase para não precisar buscar da próxima vez
      upsertCredores([{codigo:credor.id,nome:credor.nome}]).catch(()=>{});
      setCredores(cs=>{ const exists=cs.find(c=>c.codigo===credor.id); if(exists)return cs; return [...cs,{codigo:credor.id,nome:credor.nome,nome_norm:normalizar(credor.nome)}]; });
      return credor;
    }catch{ return null; }
  };

  // Cria credor novo no Sienge (quando não existe em lugar nenhum)
  const criarCredorNaSienge = async(nfId:string)=>{
    const nf=notas.find(n=>n._id===nfId); if(!nf) return;
    const cnpjLimpo=nf.cnpj_fornecedor.replace(/\D/g,"");
    if(!nf.fornecedor||!cnpjLimpo){ alert("Preencha o nome e CNPJ do fornecedor antes de criar."); return; }
    try{
      const r=await fetch("/api/financeiro/buscar-credor",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({name:nf.fornecedor,cpfCnpj:cnpjLimpo,personType:cnpjLimpo.length===14?"J":"F"}),
      });
      const data=await r.json();
      if(data.ok){
        const novoId=String(data.id??"");
        setNotas(ns=>ns.map(n=>n._id===nfId?{...n,_creditorId:novoId,_creditorName:nf.fornecedor}:n));
        if(novoId) upsertCredores([{codigo:parseInt(novoId),nome:nf.fornecedor}]).catch(()=>{});
        alert(`✓ Credor criado! ID: ${novoId}`);
      } else {
        alert(`Erro ao criar credor: ${data.error?.slice(0,200)}`);
      }
    }catch(e:any){ alert("Falha: "+e.message); }
  };

  const processarPdf = async(file:File)=>{
    setFileName(file.name); setStep("lendo"); setErroLeitura("");
    const fd=new FormData(); fd.append("pdf",file);
    try{
      const res=await fetch("/api/financeiro/pdf-nf",{method:"POST",body:fd});
      const data=await res.json();
      if(!data.ok){ setErroLeitura(data.error??"Erro"); setStep("upload"); return; }

      // 1. Tenta match pelo nome na tabela Supabase
      const lista:Nf[]=(data.notas as any[]).map((n:any)=>{
        const match=matchCredor(n.fornecedor,credores);
        return {
          ...n, _selected:true,
          _creditorId:  match?String(match.codigo):"",
          _creditorName:match?.nome??"",
          _buscado:     !!match, // marca como já buscado se achou
        };
      });
      setNotas(lista);
      setStep("revisao");

      // 2. Para os que não acharam → busca automaticamente no Sienge pelo CNPJ
      const semCredor=lista.filter(n=>!n._creditorId&&n.cnpj_fornecedor);
      if(semCredor.length>0){
        for(const nf of semCredor){
          const found=await buscarCredorNaSienge(nf.cnpj_fornecedor);
          if(found){
            setNotas(ns=>ns.map(n=>n._id===nf._id?{...n,_creditorId:String(found.id),_creditorName:found.nome}:n));
          }
        }
      }
    }catch(e:any){ setErroLeitura("Falha: "+e.message); setStep("upload"); }
  };

  const buscarCredorCnpj = async(id:string,cnpj:string)=>{
    const found=await buscarCredorNaSienge(cnpj);
    if(found) setNotas(ns=>ns.map(n=>n._id===id?{...n,_creditorId:String(found.id),_creditorName:found.nome}:n));
    else alert("Credor não encontrado no Sienge. Use 'Criar Credor' para cadastrar.");
  };

  const buscarTodos = async()=>{ for(const n of selecionadas) if(!n._creditorId&&n.cnpj_fornecedor) await buscarCredorCnpj(n._id,n.cnpj_fornecedor); };

  const enviarLote = async()=>{
    const fila=selecionadas.filter(n=>n._creditorId);
    if(!fila.length){ alert("Informe o ID do credor para ao menos uma nota."); return; }
    setStep("enviando"); setProgresso({atual:0,total:fila.length});
    const auth=btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
    for(let i=0;i<fila.length;i++){
      const n=fila[i];
      setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"enviando"}:x));
      try{
        const payload:Record<string,any>={
          creditorId:parseInt(n._creditorId,10),documentNumber:n.numero_nf||"SN",
          issueDate:fmtDate(n.data_emissao),netValue:parseBRL(n.valor_total),
          observation:n.descricao??"",
          installments:[{dueDate:fmtDate(n.data_vencimento)??fmtDate(n.data_emissao),value:parseBRL(n.valor_total)}],
        };
        const r=await fetch(`${SIENGE_BASE}/bills`,{method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload)});
        const txt=await r.text(); let data:any={}; try{data=JSON.parse(txt);}catch{}
        if(r.ok||r.status===201) setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"ok",_siengeId:String(data.id??"")}:x));
        else setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"erro",_erro:`${r.status}: ${txt.slice(0,120)}`}:x));
      }catch(e:any){ setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"erro",_erro:e.message}:x)); }
      setProgresso({atual:i+1,total:fila.length});
    }
    setStep("concluido");
  };

  const reset=()=>{ setStep("upload");setNotas([]);setFileName("");setErroLeitura("");setProgresso({atual:0,total:0}); };

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',-apple-system,sans-serif",WebkitFontSmoothing:"antialiased" as any}}>
      <header style={{height:56,background:C.surface,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 0 rgba(0,0,0,0.05)"}}>
        <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{height:36,objectFit:"contain"}}/>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:13,color:C.textMute}}>Financeiro /</span>
          <span style={{fontSize:14,fontWeight:600,color:C.text}}>Importar NF-e por PDF</span>
        </div>
        {step!=="upload"&&<Btn variant="ghost" onClick={reset} style={{fontSize:12}}>← Novo PDF</Btn>}
      </header>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"28px 20px"}}>
        {/* Steps */}
        <div style={{display:"flex",marginBottom:24,background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {(["upload","lendo","revisao","enviando","concluido"] as PageStep[]).map((s,i)=>{
            const labels:Record<string,string>={upload:"1 · Upload PDF",lendo:"2 · Lendo",revisao:"3 · Conferência",enviando:"4 · Enviando",concluido:"5 · Concluído"};
            const order=["upload","lendo","revisao","enviando","concluido"];
            const cur=order.indexOf(step); const idx=order.indexOf(s);
            return <div key={s} style={{flex:1,textAlign:"center",padding:"10px 0",fontSize:12,fontWeight:idx===cur?600:400,color:idx===cur?C.primary:idx<cur?C.success:C.textMute,borderBottom:`2px solid ${idx===cur?C.primary:idx<cur?C.success:"transparent"}`,borderRight:i<4?`1px solid ${C.border}`:undefined}}>{idx<cur?"✓ ":""}{labels[s]}</div>;
          })}
        </div>

        {/* UPLOAD */}
        {(step==="upload"||step==="lendo")&&(
          <Card>
            <CardHeader title="Selecionar PDF com DANFEs" sub={`Credores carregados do Supabase: ${credores.length}`}/>
            <div style={{padding:24}}>
              <div onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f?.name.endsWith(".pdf"))processarPdf(f);}} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileRef.current?.click()}
                style={{border:`2px dashed ${dragOver?C.primary:C.borderMid}`,borderRadius:12,padding:"40px 32px",textAlign:"center",cursor:"pointer",background:dragOver?C.primaryBg:C.bg,transition:"all .2s",display:"flex",flexDirection:"column",alignItems:"center",gap:12}}>
                <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)processarPdf(f);}}/>
                <div style={{fontSize:48}}>{step==="lendo"?"⏳":"📄"}</div>
                <div style={{fontSize:16,fontWeight:600,color:C.text}}>{step==="lendo"?"Lendo com IA…":"Arraste o PDF ou clique para selecionar"}</div>
                <div style={{fontSize:13,color:C.textMute}}>PDF com 1 ou mais DANFEs escaneadas · Matching automático de credores</div>
              </div>
              {erroLeitura&&<div style={{marginTop:16,background:C.dangerBg,border:`1px solid ${C.danger}`,borderRadius:8,padding:"12px 16px",fontSize:13,color:C.danger}}>⚠ {erroLeitura}</div>}
            </div>
          </Card>
        )}

        {/* REVISÃO / ENVIANDO / CONCLUÍDO */}
        {(step==="revisao"||step==="enviando"||step==="concluido")&&(
          <>
            {/* Cards resumo */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
              {[["Total NFs",resumo.total,C.text],["Selecionadas",selecionadas.length,C.primary],["Enviadas",resumo.ok,C.success],["Com erro",resumo.erro,resumo.erro>0?C.danger:C.textMute]].map(([l,v,c])=>(
                <Card key={String(l)} style={{padding:"14px 18px"}}>
                  <div style={{fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase" as any,letterSpacing:"0.06em",marginBottom:4}}>{l}</div>
                  <div style={{fontSize:28,fontWeight:700,color:String(c)}}>{v}</div>
                </Card>
              ))}
            </div>

            {/* Progresso */}
            {step==="enviando"&&(
              <Card style={{marginBottom:16}}>
                <div style={{padding:"14px 18px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13}}>
                    <span style={{fontWeight:600,color:C.text}}>Enviando para o Sienge…</span>
                    <span style={{color:C.textMute}}>{progresso.atual} / {progresso.total}</span>
                  </div>
                  <div style={{height:8,background:C.bg,borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:99,background:C.accent,width:`${progresso.total>0?(progresso.atual/progresso.total)*100:0}%`,transition:"width .4s ease"}}/>
                  </div>
                </div>
              </Card>
            )}

            {/* Tabela */}
            <Card>
              <CardHeader title={`NFs extraídas — ${fileName}`} sub="Campos editáveis · Credor preenchido automaticamente pelo Supabase"
                right={step==="revisao"?(
                  <div style={{display:"flex",gap:8}}>
                    <Btn variant="ghost" onClick={buscarTodos} style={{fontSize:12}}>🔍 Buscar credores (CNPJ)</Btn>
                    <Btn variant="accent" disabled={selecionadas.length===0} onClick={enviarLote}>🚀 Enviar {selecionadas.length>0?`(${selecionadas.length})`:""} ao Sienge</Btn>
                  </div>
                ):step==="concluido"?<Btn variant="accent" onClick={reset}>Importar novo PDF</Btn>:null}
              />
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:C.bg,borderBottom:`1px solid ${C.border}`}}>
                      <th style={{padding:"10px 12px",textAlign:"center" as any,width:36}}>
                        <input type="checkbox" checked={allSel} onChange={e=>toggleAll(e.target.checked)} disabled={step!=="revisao"}/>
                      </th>
                      <th style={th}>Pág.</th>
                      <th style={th}>Status</th>
                      <th style={th}>Nº NF</th>
                      <th style={th}>Série</th>
                      <th style={th}>Fornecedor</th>
                      <th style={th}>CNPJ</th>
                      <th style={th}>Emissão</th>
                      <th style={th}>Vencimento</th>
                      <th style={th}>Valor Total</th>
                      <th style={th}>Descrição</th>
                      <th style={{...th,color:C.accent}}>ID Credor *</th>
                      <th style={th}>ID Sienge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notas.map(n=>(
                      <tr key={n._id} style={{borderBottom:`1px solid ${C.border}`,background:n._status==="ok"?C.successBg:n._status==="erro"?C.dangerBg:n._selected?"#fefce8":C.surface}}>
                        <td style={{padding:"8px 12px",textAlign:"center" as any}}>
                          <input type="checkbox" checked={n._selected&&n._status==="pendente"} onChange={()=>toggleSel(n._id)} disabled={n._status!=="pendente"}/>
                        </td>
                        <td style={td}>{n.pagina}</td>
                        <td style={{...td,whiteSpace:"nowrap" as any}}>
                          <span style={{display:"inline-block",padding:"2px 8px",borderRadius:99,fontSize:11,fontWeight:600,background:statusBg(n._status),color:statusColor(n._status)}}>{statusLabel(n._status)}</span>
                          {n._erro&&<div style={{fontSize:10,color:C.danger,marginTop:2,maxWidth:140}}>{n._erro}</div>}
                        </td>
                        <td style={td}><EditableCell value={n.numero_nf}      onChange={v=>updNf(n._id,"numero_nf",v)}      width={70}/></td>
                        <td style={td}><EditableCell value={n.serie}           onChange={v=>updNf(n._id,"serie",v)}           width={44}/></td>
                        <td style={td}><EditableCell value={n.fornecedor}      onChange={v=>updNf(n._id,"fornecedor",v)}      width={180}/></td>
                        <td style={td}><EditableCell value={n.cnpj_fornecedor} onChange={v=>updNf(n._id,"cnpj_fornecedor",v)} width={130}/></td>
                        <td style={td}><EditableCell value={n.data_emissao}    onChange={v=>updNf(n._id,"data_emissao",v)}    width={90}/></td>
                        <td style={td}><EditableCell value={n.data_vencimento} onChange={v=>updNf(n._id,"data_vencimento",v)} width={90}/></td>
                        <td style={td}><EditableCell value={n.valor_total}     onChange={v=>updNf(n._id,"valor_total",v)}     width={90}/></td>
                        <td style={td}><EditableCell value={n.descricao}       onChange={v=>updNf(n._id,"descricao",v)}       width={160}/></td>
                        <td style={td}>
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{display:"flex",gap:4,alignItems:"center"}}>
                              <EditableCell value={n._creditorId} onChange={v=>updNf(n._id,"_creditorId" as any,v)} width={66}/>
                              <button type="button" title="Buscar pelo CNPJ no Sienge" onClick={()=>buscarCredorCnpj(n._id,n.cnpj_fornecedor)} style={{height:28,width:28,border:`1px solid ${C.border}`,borderRadius:6,background:C.surface,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>🔍</button>
                            </div>
                            {n._creditorName
                              ? <div style={{fontSize:10,color:C.success,maxWidth:120}}>{n._creditorName}</div>
                              : <button type="button" onClick={()=>criarCredorNaSienge(n._id)} style={{fontSize:10,color:C.accent,background:"none",border:"none",cursor:"pointer",padding:0,textAlign:"left" as any,textDecoration:"underline"}}>+ Criar credor</button>
                            }
                          </div>
                        </td>
                        <td style={{...td,fontWeight:600,color:C.success}}>{n._siengeId||"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {step==="revisao"&&(
                <div style={{padding:"12px 18px",borderTop:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:C.textMute}}>{selecionadas.filter(n=>n._creditorId).length} de {selecionadas.length} com credor preenchido</span>
                  <Btn variant="accent" disabled={selecionadas.length===0} onClick={enviarLote} style={{height:38,fontSize:14}}>🚀 Enviar {selecionadas.length>0?`${selecionadas.length} NF${selecionadas.length>1?"s":""}`:""}  ao Sienge</Btn>
                </div>
              )}
              {step==="concluido"&&(
                <div style={{padding:"16px 18px",borderTop:`1px solid ${C.border}`,background:C.successBg,borderRadius:"0 0 10px 10px"}}>
                  <div style={{fontSize:14,fontWeight:600,color:C.success}}>✅ {resumo.ok} NF{resumo.ok!==1?"s":""} enviada{resumo.ok!==1?"s":""} com sucesso{resumo.erro>0?` · ${resumo.erro} com erro`:""}</div>
                  <div style={{fontSize:12,color:C.textMid,marginTop:4}}>Títulos disponíveis em Financeiro → Contas a Pagar no Sienge.</div>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

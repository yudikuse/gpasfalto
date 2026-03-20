// FILE: app/financeiro/pdf-nf/page.tsx
"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { matchCredor, buscarTodosCredores, upsertCredores, normalizar, type Credor } from "@/app/financeiro/credores/page";

const C = {
  bg:"#f4f5f7",surface:"#ffffff",border:"#e8eaed",borderMid:"#d1d5db",
  text:"#1a1f36",textMid:"#4b5563",textMute:"#9ca3af",
  primary:"#4361ee",primaryBg:"#eef1fd",accent:"#ff4b2b",accentBg:"#fff1ee",
  success:"#0d9f6e",successBg:"#ecfdf5",danger:"#dc2626",dangerBg:"#fef2f2",
  warning:"#d97706",warningBg:"#fffbeb",
};

type NfStatus = "pendente"|"enviando"|"ok"|"erro"|"duplicada";
type PageStep  = "upload"|"lendo"|"revisao"|"confirmando"|"enviando"|"concluido";

type Nf = {
  _id:string; _status:NfStatus; _erro:string|null; _siengeId:string|null;
  _creditorId:string; _creditorName:string; _selected:boolean;
  pagina:number; numero_nf:string; serie:string;
  fornecedor:string; cnpj_fornecedor:string;
  data_emissao:string; data_vencimento:string;
  valor_total:string; descricao:string;
};

function parseBRL(v:string){ return parseFloat(String(v??"").replace(/[R$\s]/g,"").replace(/\./g,"").replace(",","."))||0; }
function fmtDate(d:string):string|null{ if(!d)return null; const m=d.match(/(\d{2})\/(\d{2})\/(\d{4})/); if(m)return`${m[3]}-${m[2]}-${m[1]}`; if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d; return null; }

// ── Componentes ──────────────────────────────────────────────────────────────

function Card({children,style}:{children:React.ReactNode;style?:React.CSSProperties}){
  return <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",...style}}>{children}</div>;
}

function Btn({children,onClick,disabled,variant="default",style}:{
  children:React.ReactNode;onClick?:()=>void;disabled?:boolean;variant?:string;style?:React.CSSProperties;
}){
  const vs:Record<string,React.CSSProperties>={
    default:{background:C.surface,color:C.textMid,border:`1px solid ${C.border}`},
    accent:{background:C.accent,color:"#fff",border:"none"},
    success:{background:C.success,color:"#fff",border:"none"},
    ghost:{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`},
    warning:{background:C.warningBg,color:C.warning,border:`1px solid ${C.warning}`},
  };
  return <button type="button" onClick={onClick} disabled={disabled} style={{
    height:34,padding:"0 14px",borderRadius:8,fontSize:13,fontWeight:600,
    cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,
    display:"inline-flex",alignItems:"center",gap:6,fontFamily:"inherit",
    ...(vs[variant]??vs.default),...style,
  }}>{children}</button>;
}

// ── Card de NF individual ────────────────────────────────────────────────────

function NfCard({ n, onUpdate, onToggle, onBuscarCredor, onCriarCredor, readonly }:{
  n:Nf;
  onUpdate:(key:keyof Nf,val:string)=>void;
  onToggle:()=>void;
  onBuscarCredor:()=>void;
  onCriarCredor:()=>void;
  readonly:boolean;
}){
  const statusColors:Record<NfStatus,{bg:string;color:string;label:string}>={
    pendente: {bg:"#f3f4f6",   color:C.textMute, label:"Pendente"},
    enviando: {bg:C.primaryBg, color:C.primary,  label:"⟳ Enviando…"},
    ok:       {bg:C.successBg, color:C.success,  label:"✓ Enviada"},
    erro:     {bg:C.dangerBg,  color:C.danger,   label:"✗ Erro"},
    duplicada:{bg:C.warningBg, color:C.warning,  label:"⚠ Duplicada"},
  };
  const s = statusColors[n._status];

  const inp = (val:string, key:keyof Nf, w=120):React.ReactNode => (
    <input value={val??""} onChange={e=>onUpdate(key,e.target.value)} disabled={readonly}
      style={{width:w,height:30,padding:"0 8px",border:`1px solid ${C.border}`,borderRadius:6,
        fontSize:12,color:C.text,background:readonly?C.bg:C.surface,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}} />
  );

  return (
    <div style={{
      border:`1px solid ${n._selected&&!readonly?C.accent:C.border}`,
      borderRadius:10,background:n._status==="ok"?C.successBg:n._status==="duplicada"?C.warningBg:n._status==="erro"?C.dangerBg:C.surface,
      overflow:"hidden",
    }}>
      {/* Cabeçalho do card */}
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        {!readonly && (
          <input type="checkbox" checked={n._selected&&n._status==="pendente"} onChange={onToggle}
            disabled={n._status!=="pendente"} style={{cursor:"pointer",width:16,height:16}} />
        )}
        <span style={{display:"inline-block",padding:"2px 10px",borderRadius:99,fontSize:11,fontWeight:700,background:s.bg,color:s.color}}>{s.label}</span>
        <span style={{fontSize:13,fontWeight:700,color:C.text}}>NF {n.numero_nf}</span>
        {n.serie && <span style={{fontSize:12,color:C.textMute}}>Série {n.serie}</span>}
        <span style={{fontSize:13,fontWeight:600,color:C.accent,marginLeft:"auto"}}>
          R$ {n.valor_total}
        </span>
        {n._siengeId && (
          <span style={{fontSize:11,background:C.successBg,color:C.success,padding:"2px 8px",borderRadius:99,fontWeight:600}}>
            ID Sienge: {n._siengeId}
          </span>
        )}
        {n._erro && <span style={{fontSize:11,color:C.danger,maxWidth:300}}>{n._erro}</span>}
      </div>

      {/* Corpo do card — grid 2 colunas */}
      <div style={{padding:"12px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px 20px"}}>
        {/* Fornecedor */}
        <div style={{gridColumn:"1/-1"}}>
          <div style={{fontSize:10,fontWeight:600,color:C.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Fornecedor</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            {inp(n.fornecedor,"fornecedor",200)}
            <span style={{fontSize:11,color:C.textMute}}>{n.cnpj_fornecedor}</span>
          </div>
        </div>

        {/* Datas */}
        <div>
          <div style={{fontSize:10,fontWeight:600,color:C.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Emissão</div>
          {inp(n.data_emissao,"data_emissao",110)}
        </div>
        <div>
          <div style={{fontSize:10,fontWeight:600,color:C.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Vencimento</div>
          {inp(n.data_vencimento,"data_vencimento",110)}
        </div>

        {/* Descrição */}
        <div style={{gridColumn:"1/-1"}}>
          <div style={{fontSize:10,fontWeight:600,color:C.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>Descrição</div>
          {inp(n.descricao,"descricao",400)}
        </div>

        {/* Credor */}
        <div style={{gridColumn:"1/-1"}}>
          <div style={{fontSize:10,fontWeight:600,color:n._creditorId?C.textMute:C.accent,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:3}}>
            {n._creditorId ? "Credor Sienge" : "⚠ Credor — obrigatório"}
          </div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <input value={n._creditorId} onChange={e=>onUpdate("_creditorId" as keyof Nf,e.target.value)} disabled={readonly}
              placeholder="ID numérico"
              style={{width:80,height:30,padding:"0 8px",border:`1px solid ${n._creditorId?C.border:C.accent}`,borderRadius:6,
                fontSize:12,color:C.text,background:readonly?C.bg:C.surface,outline:"none",fontFamily:"inherit"}} />
            {n._creditorName && (
              <span style={{fontSize:12,color:C.success,fontWeight:600}}>✓ {n._creditorName}</span>
            )}
            {!readonly && !n._creditorId && (
              <>
                <Btn variant="ghost" onClick={onBuscarCredor} style={{height:30,fontSize:11}}>🔍 Buscar CNPJ</Btn>
                <Btn variant="warning" onClick={onCriarCredor} style={{height:30,fontSize:11}}>+ Criar credor</Btn>
              </>
            )}
            {!readonly && n._creditorId && !n._creditorName && (
              <Btn variant="ghost" onClick={onBuscarCredor} style={{height:30,fontSize:11}}>🔍 Verificar</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de confirmação ─────────────────────────────────────────────────────

function ModalConfirmacao({ notas, onConfirmar, onCancelar }:{
  notas:Nf[]; onConfirmar:()=>void; onCancelar:()=>void;
}){
  const total = notas.reduce((acc,n)=>acc+parseBRL(n.valor_total),0);
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:C.surface,borderRadius:14,maxWidth:560,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:16,fontWeight:700,color:C.text}}>Confirmar envio para o Sienge</div>
          <div style={{fontSize:13,color:C.textMute,marginTop:4}}>
            {notas.length} NF{notas.length>1?"s":""} · Total: <strong>R$ {total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</strong>
          </div>
        </div>
        <div style={{padding:"16px 24px",maxHeight:320,overflowY:"auto"}}>
          {notas.map(n=>(
            <div key={n._id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{n.fornecedor||"—"}</div>
                <div style={{fontSize:11,color:C.textMute}}>NF {n.numero_nf} · Credor: {n._creditorId} · Venc: {n.data_vencimento||n.data_emissao}</div>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:C.accent}}>R$ {n.valor_total}</div>
            </div>
          ))}
        </div>
        <div style={{padding:"16px 24px",background:"#fafafa",borderRadius:"0 0 14px 14px",display:"flex",gap:10,justifyContent:"flex-end"}}>
          <Btn variant="ghost" onClick={onCancelar}>Cancelar</Btn>
          <Btn variant="accent" onClick={onConfirmar} style={{height:38,fontSize:14}}>
            🚀 Confirmar e Enviar
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PdfNfPage() {
  const [step,setStep]           = useState<PageStep>("upload");
  const [notas,setNotas]         = useState<Nf[]>([]);
  const [credores,setCredores]   = useState<Credor[]>([]);
  const [fileName,setFileName]   = useState("");
  const [erroLeitura,setErroLeitura] = useState("");
  const [progresso,setProgresso] = useState({atual:0,total:0});
  const [dragOver,setDragOver]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(()=>{ buscarTodosCredores().then(setCredores).catch(console.error); },[]);

  const updNf = (id:string,key:keyof Nf,val:string) =>
    setNotas(ns=>ns.map(n=>n._id===id?{...n,[key]:val}:n));
  const toggleSel = (id:string) =>
    setNotas(ns=>ns.map(n=>n._id===id&&n._status==="pendente"?{...n,_selected:!n._selected}:n));

  const selecionadas = notas.filter(n=>n._selected&&n._status==="pendente");
  const resumo = {
    total:notas.length,
    ok:notas.filter(n=>n._status==="ok").length,
    erro:notas.filter(n=>n._status==="erro").length,
    duplicada:notas.filter(n=>n._status==="duplicada").length,
  };

  // ── Buscar credor na Sienge via proxy ──────────────────────────────
  const buscarCredorNaSienge = async(cnpj:string):Promise<{id:number;nome:string}|null>=>{
    const limpo=cnpj.replace(/\D/g,""); if(!limpo) return null;
    try{
      const r=await fetch(`/api/financeiro/buscar-credor?cnpj=${limpo}`);
      const d=await r.json();
      if(!d.ok||!d.found) return null;
      upsertCredores([{codigo:d.id,nome:d.nome}]).catch(()=>{});
      setCredores(cs=>cs.find(c=>c.codigo===d.id)?cs:[...cs,{codigo:d.id,nome:d.nome,nome_norm:normalizar(d.nome)}]);
      return {id:d.id,nome:d.nome};
    }catch{return null;}
  };

  const buscarCredorBtn = async(nfId:string)=>{
    const nf=notas.find(n=>n._id===nfId); if(!nf) return;
    const found=await buscarCredorNaSienge(nf.cnpj_fornecedor);
    if(found) setNotas(ns=>ns.map(n=>n._id===nfId?{...n,_creditorId:String(found.id),_creditorName:found.nome}:n));
    else alert("Não encontrado no Sienge. Use '+ Criar credor'.");
  };

  const criarCredorBtn = async(nfId:string)=>{
    const nf=notas.find(n=>n._id===nfId); if(!nf) return;
    const cnpjLimpo=nf.cnpj_fornecedor.replace(/\D/g,"");
    if(!nf.fornecedor||!cnpjLimpo){alert("Preencha nome e CNPJ antes de criar.");return;}
    try{
      const r=await fetch("/api/financeiro/buscar-credor",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:nf.fornecedor,cpfCnpj:cnpjLimpo,personType:cnpjLimpo.length===14?"J":"F"})});
      const d=await r.json();
      if(d.ok){
        const id=String(d.id??"");
        setNotas(ns=>ns.map(n=>n._id===nfId?{...n,_creditorId:id,_creditorName:nf.fornecedor}:n));
        if(id) upsertCredores([{codigo:parseInt(id),nome:nf.fornecedor}]).catch(()=>{});
        alert(`✓ Credor criado! ID: ${id}`);
      } else { alert("Erro: "+d.error?.slice(0,200)); }
    }catch(e:any){alert("Falha: "+e.message);}
  };

  // ── Processar PDF ──────────────────────────────────────────────────
  const processarPdf = async(file:File)=>{
    setFileName(file.name); setStep("lendo"); setErroLeitura("");
    const fd=new FormData(); fd.append("pdf",file);
    try{
      const res=await fetch("/api/financeiro/pdf-nf",{method:"POST",body:fd});
      const data=await res.json();
      if(!data.ok){setErroLeitura(data.error??"Erro");setStep("upload");return;}
      const lista:Nf[]=(data.notas as any[]).map((n:any)=>{
        const match=matchCredor(n.fornecedor,credores);
        return {...n,_selected:true,_creditorId:match?String(match.codigo):"",_creditorName:match?.nome??""};
      });
      setNotas(lista); setStep("revisao");
      // Auto-busca no Sienge para os sem credor
      const semCredor=lista.filter(n=>!n._creditorId&&n.cnpj_fornecedor);
      for(const nf of semCredor){
        const found=await buscarCredorNaSienge(nf.cnpj_fornecedor);
        if(found) setNotas(ns=>ns.map(n=>n._id===nf._id?{...n,_creditorId:String(found.id),_creditorName:found.nome}:n));
      }
    }catch(e:any){setErroLeitura("Falha: "+e.message);setStep("upload");}
  };

  // ── Verificar duplicatas antes de enviar ───────────────────────────
  const verificarEEnviar = async()=>{
    const fila=selecionadas.filter(n=>n._creditorId);
    if(!fila.length){alert("Informe o ID do credor para ao menos uma NF.");return;}
    // Marca duplicatas conhecidas (mesmo num_doc + credor já existente no Sienge)
    setStep("confirmando");
  };

  // ── Enviar lote ────────────────────────────────────────────────────
  const enviarLote = async()=>{
    const fila=selecionadas.filter(n=>n._creditorId);
    setStep("enviando"); setProgresso({atual:0,total:fila.length});
    for(let i=0;i<fila.length;i++){
      const n=fila[i];
      setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"enviando"}:x));
      try{
        // Verifica duplicata: GET /bills com docNumber + creditorId
        const auth_check=await fetch(`/api/financeiro/criar-titulo`,{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            creditorId:parseInt(n._creditorId,10),
            documentNumber:n.numero_nf||"SN",
            issueDate:fmtDate(n.data_emissao),
            netValue:parseBRL(n.valor_total),
            observation:n.descricao??"",
            installments:[{dueDate:fmtDate(n.data_vencimento)??fmtDate(n.data_emissao),value:parseBRL(n.valor_total)}],
          }),
        });
        const d=await auth_check.json();
        if(d.ok){
          setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"ok",_siengeId:String(d.id??"")}:x));
        } else if(String(d.error??"").toLowerCase().includes("duplica")||d.status===409){
          setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"duplicada",_erro:"Título já existe no Sienge"}:x));
        } else {
          setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"erro",_erro:`${d.status??""}: ${String(d.error??"").slice(0,100)}`}:x));
        }
      }catch(e:any){setNotas(ns=>ns.map(x=>x._id===n._id?{...x,_status:"erro",_erro:e.message}:x));}
      setProgresso({atual:i+1,total:fila.length});
    }
    setStep("concluido");
  };

  const reset=()=>{setStep("upload");setNotas([]);setFileName("");setErroLeitura("");setProgresso({atual:0,total:0});};
  const readonly = step==="enviando"||step==="concluido"||step==="confirmando";

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',-apple-system,sans-serif"}}>
      {/* Modal confirmação */}
      {step==="confirmando"&&(
        <ModalConfirmacao
          notas={selecionadas.filter(n=>n._creditorId)}
          onConfirmar={enviarLote}
          onCancelar={()=>setStep("revisao")}
        />
      )}

      {/* Topbar */}
      <header style={{height:56,background:C.surface,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 0 rgba(0,0,0,0.05)"}}>
        <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{height:36,objectFit:"contain"}}/>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:13,color:C.textMute}}>Financeiro /</span>
          <span style={{fontSize:14,fontWeight:600,color:C.text}}>Importar NF-e por PDF</span>
        </div>
        {step!=="upload"&&<Btn variant="ghost" onClick={reset} style={{fontSize:12}}>← Novo PDF</Btn>}
      </header>

      <div style={{maxWidth:900,margin:"0 auto",padding:"28px 20px"}}>
        {/* Steps */}
        <div style={{display:"flex",marginBottom:24,background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {(["upload","lendo","revisao","confirmando","enviando","concluido"] as PageStep[]).map((s,i)=>{
            const labels:Record<string,string>={upload:"1 · Upload",lendo:"2 · Lendo",revisao:"3 · Conferência",confirmando:"4 · Confirmação",enviando:"5 · Enviando",concluido:"6 · Concluído"};
            const order=["upload","lendo","revisao","confirmando","enviando","concluido"];
            const cur=order.indexOf(step); const idx=order.indexOf(s);
            return <div key={s} style={{flex:1,textAlign:"center",padding:"10px 0",fontSize:11,fontWeight:idx===cur?600:400,color:idx===cur?C.primary:idx<cur?C.success:C.textMute,borderBottom:`2px solid ${idx===cur?C.primary:idx<cur?C.success:"transparent"}`,borderRight:i<5?`1px solid ${C.border}`:undefined}}>{idx<cur?"✓ ":""}{labels[s]}</div>;
          })}
        </div>

        {/* UPLOAD */}
        {(step==="upload"||step==="lendo")&&(
          <Card>
            <div style={{padding:"16px 18px 12px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:C.text}}>Selecionar PDF com DANFEs</div>
                <div style={{fontSize:12,color:C.textMute,marginTop:2}}>{credores.length} credores no Supabase · matching automático</div>
              </div>
            </div>
            <div style={{padding:20}}>
              <div onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f?.name.endsWith(".pdf"))processarPdf(f);}} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onClick={()=>fileRef.current?.click()}
                style={{border:`2px dashed ${dragOver?C.primary:C.borderMid}`,borderRadius:12,padding:"40px",cursor:"pointer",background:dragOver?C.primaryBg:C.bg,display:"flex",flexDirection:"column",alignItems:"center",gap:12,transition:"all .2s"}}>
                <input ref={fileRef} type="file" accept=".pdf" style={{display:"none"}} onChange={(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)processarPdf(f);}}/>
                <div style={{fontSize:48}}>{step==="lendo"?"⏳":"📄"}</div>
                <div style={{fontSize:16,fontWeight:600,color:C.text}}>{step==="lendo"?"Lendo com IA…":"Arraste o PDF ou clique para selecionar"}</div>
                <div style={{fontSize:13,color:C.textMute}}>PDF com 1 ou mais DANFEs · Google Vision · sem custo</div>
              </div>
              {erroLeitura&&<div style={{marginTop:16,background:C.dangerBg,border:`1px solid ${C.danger}`,borderRadius:8,padding:"12px 16px",fontSize:13,color:C.danger}}>{erroLeitura}</div>}
            </div>
          </Card>
        )}

        {/* REVISÃO / ENVIANDO / CONCLUÍDO */}
        {(step==="revisao"||step==="confirmando"||step==="enviando"||step==="concluido")&&(
          <>
            {/* Cards resumo */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
              {([["Total",resumo.total,C.text],["Selecionadas",selecionadas.length,C.primary],["Enviadas",resumo.ok,C.success],["Erros/Dup",resumo.erro+resumo.duplicada,(resumo.erro+resumo.duplicada)>0?C.danger:C.textMute]] as [string,number,string][]).map(([l,v,c])=>(
                <Card key={l} style={{padding:"12px 16px"}}>
                  <div style={{fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>{l}</div>
                  <div style={{fontSize:26,fontWeight:700,color:c}}>{v}</div>
                </Card>
              ))}
            </div>

            {/* Progresso */}
            {step==="enviando"&&(
              <Card style={{marginBottom:16}}>
                <div style={{padding:"14px 18px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8,fontSize:13}}>
                    <span style={{fontWeight:600}}>Enviando…</span>
                    <span style={{color:C.textMute}}>{progresso.atual} / {progresso.total}</span>
                  </div>
                  <div style={{height:8,background:C.bg,borderRadius:99,overflow:"hidden"}}>
                    <div style={{height:"100%",borderRadius:99,background:C.accent,width:`${progresso.total>0?(progresso.atual/progresso.total)*100:0}%`,transition:"width .4s"}}/>
                  </div>
                </div>
              </Card>
            )}

            {/* Header da lista */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{fontSize:13,color:C.textMute}}>{fileName} · {notas.length} NF{notas.length!==1?"s":""}</div>
              {step==="revisao"&&(
                <div style={{display:"flex",gap:8}}>
                  <Btn variant="ghost" style={{fontSize:12}}
                    onClick={async()=>{for(const n of selecionadas)if(!n._creditorId&&n.cnpj_fornecedor)await buscarCredorBtn(n._id);}}>
                    🔍 Buscar todos
                  </Btn>
                  <Btn variant="accent" disabled={selecionadas.filter(n=>n._creditorId).length===0} onClick={verificarEEnviar}>
                    🚀 Enviar {selecionadas.filter(n=>n._creditorId).length>0?`(${selecionadas.filter(n=>n._creditorId).length})`:""}
                  </Btn>
                </div>
              )}
              {step==="concluido"&&<Btn variant="accent" onClick={reset}>Importar novo PDF</Btn>}
            </div>

            {/* Cards de NF */}
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {notas.map(n=>(
                <NfCard key={n._id} n={n} readonly={readonly}
                  onUpdate={(key,val)=>updNf(n._id,key,val)}
                  onToggle={()=>toggleSel(n._id)}
                  onBuscarCredor={()=>buscarCredorBtn(n._id)}
                  onCriarCredor={()=>criarCredorBtn(n._id)}
                />
              ))}
            </div>

            {/* Rodapé */}
            {step==="revisao"&&(
              <div style={{marginTop:16,display:"flex",justifyContent:"flex-end"}}>
                <Btn variant="accent" disabled={selecionadas.filter(n=>n._creditorId).length===0} onClick={verificarEEnviar} style={{height:38,fontSize:14}}>
                  🚀 Enviar {selecionadas.filter(n=>n._creditorId).length} NF{selecionadas.filter(n=>n._creditorId).length!==1?"s":""} ao Sienge
                </Btn>
              </div>
            )}

            {/* Concluído */}
            {step==="concluido"&&(
              <div style={{marginTop:16,background:C.successBg,border:`1px solid ${C.success}`,borderRadius:10,padding:"16px 20px"}}>
                <div style={{fontSize:15,fontWeight:700,color:C.success}}>
                  ✅ {resumo.ok} NF{resumo.ok!==1?"s":""} enviada{resumo.ok!==1?"s":""} com sucesso
                  {resumo.duplicada>0&&<span style={{color:C.warning,marginLeft:12}}>· {resumo.duplicada} duplicada{resumo.duplicada!==1?"s":""}</span>}
                  {resumo.erro>0&&<span style={{color:C.danger,marginLeft:12}}>· {resumo.erro} com erro</span>}
                </div>
                <div style={{fontSize:12,color:C.textMid,marginTop:4}}>Títulos disponíveis em Financeiro → Contas a Pagar no Sienge.</div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

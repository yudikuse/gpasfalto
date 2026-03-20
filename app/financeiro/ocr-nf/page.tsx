// FILE: app/financeiro/ocr-nf/page.tsx
"use client";

import { useCallback, useRef, useState, useEffect, type CSSProperties } from "react";
import { matchCredor, buscarTodosCredores, type Credor } from "@/app/financeiro/credores/page";

const SIENGE_TENANT = process.env.NEXT_PUBLIC_SIENGE_TENANT ?? "";
const SIENGE_USER   = process.env.NEXT_PUBLIC_SIENGE_USER   ?? "";
const SIENGE_PASS   = process.env.NEXT_PUBLIC_SIENGE_PASS   ?? "";
const SIENGE_BASE   = `https://api.sienge.com.br/${SIENGE_TENANT}/public/api/v1`;

const C = {
  bg:"#f4f5f7",surface:"#ffffff",border:"#e8eaed",borderMid:"#d1d5db",
  text:"#1a1f36",textMid:"#4b5563",textMute:"#9ca3af",
  primary:"#4361ee",primaryBg:"#eef1fd",accent:"#ff4b2b",
  success:"#0d9f6e",successBg:"#ecfdf5",danger:"#dc2626",dangerBg:"#fef2f2",
};

type Step = "upload"|"processing"|"review"|"sending"|"done"|"error";
type InputMode = "image"|"xml";
type NfFields = {
  tipo_nota:string; fornecedor:string; cnpj_fornecedor:string;
  numero_nf:string; serie:string; chave_acesso:string;
  data_emissao:string; data_vencimento:string; valor_total:string;
  condicao_pagamento:string; descricao:string;
};
type LogLine = {msg:string; ok:boolean; ts:string};

function parseBRL(val:string):number{ return parseFloat(String(val??"").replace(/[R$\s]/g,"").replace(/\./g,"").replace(",","."))||0; }
function fmtDate(d:string):string|null{ if(!d)return null; const m=d.match(/(\d{2})\/(\d{2})\/(\d{4})/); if(m)return`${m[3]}-${m[2]}-${m[1]}`; if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d; return null; }

function Card({children,style}:{children:React.ReactNode;style?:CSSProperties}){
  return <div style={{background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(0,0,0,0.06)",...style}}>{children}</div>;
}
function CardHeader({title,sub}:{title:string;sub?:string}){
  return <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${C.border}`}}>
    <div style={{fontSize:14,fontWeight:600,color:C.text}}>{title}</div>
    {sub&&<div style={{fontSize:12,color:C.textMute,marginTop:2}}>{sub}</div>}
  </div>;
}
function Btn({children,onClick,disabled,variant="default",style}:{children:React.ReactNode;onClick?:()=>void;disabled?:boolean;variant?:string;style?:CSSProperties}){
  const vs:Record<string,CSSProperties>={
    default:{background:C.surface,color:C.textMid,border:`1px solid ${C.border}`},
    accent:{background:C.accent,color:"#fff",border:"none"},
    success:{background:C.success,color:"#fff",border:"none"},
    ghost:{background:"transparent",color:C.textMid,border:`1px solid ${C.border}`},
  };
  return <button type="button" onClick={onClick} disabled={disabled} style={{height:34,padding:"0 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:disabled?"not-allowed":"pointer",opacity:disabled?0.45:1,display:"inline-flex",alignItems:"center",gap:6,fontFamily:"inherit",...(vs[variant]??vs.default),...style}}>{children}</button>;
}
function FieldInput({label,value,onChange,wide}:{label:string;value:string;onChange:(v:string)=>void;wide?:boolean}){
  return <div style={{gridColumn:wide?"1/-1":undefined}}>
    <div style={{fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase" as any,letterSpacing:"0.06em",marginBottom:4}}>{label}</div>
    <input value={value??""} onChange={e=>onChange(e.target.value)} style={{width:"100%",height:34,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surface,outline:"none",fontFamily:"inherit",boxSizing:"border-box" as any}}/>
  </div>;
}

const fieldLabels:Record<string,string>={
  tipo_nota:"Tipo de Nota",fornecedor:"Fornecedor",cnpj_fornecedor:"CNPJ",
  numero_nf:"Número NF",serie:"Série",chave_acesso:"Chave de Acesso",
  data_emissao:"Data Emissão",data_vencimento:"Vencimento",
  valor_total:"Valor Total",condicao_pagamento:"Cond. Pagamento",descricao:"Descrição",
};
const fieldOrder=["tipo_nota","fornecedor","cnpj_fornecedor","numero_nf","serie","chave_acesso","data_emissao","data_vencimento","condicao_pagamento","valor_total","descricao"] as const;

export default function OcrNfPage() {
  const [step,setStep]           = useState<Step>("upload");
  const [mode,setMode]           = useState<InputMode>("image");
  const [file,setFile]           = useState<File|null>(null);
  const [preview,setPreview]     = useState<string|null>(null);
  const [xmlText,setXmlText]     = useState("");
  const [dragOver,setDragOver]   = useState(false);
  const [fields,setFields]       = useState<NfFields|null>(null);
  const [creditorId,setCreditorId] = useState("");
  const [creditorName,setCreditorName] = useState("");
  const [docTypeId,setDocTypeId] = useState("");
  const [result,setResult]       = useState<any>(null);
  const [errorMsg,setErrorMsg]   = useState("");
  const [log,setLog]             = useState<LogLine[]>([]);
  const [credores,setCredores]   = useState<Credor[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carrega credores do Supabase ao montar
  useEffect(()=>{ buscarTodosCredores().then(setCredores).catch(console.error); },[]);

  const addLog = useCallback((msg:string,ok=true)=>{
    setLog(l=>[...l,{msg,ok,ts:new Date().toLocaleTimeString("pt-BR")}]);
  },[]);

  const handleFile = (f:File)=>{
    setFile(f);
    const r=new FileReader(); r.onload=e=>setPreview(e.target?.result as string); r.readAsDataURL(f);
  };

  // OCR via Google Vision (backend)
  const extractData = async()=>{
    setStep("processing"); setLog([]);
    addLog("Enviando nota para leitura com IA…");
    try{
      let messages:any[];
      if(mode==="image"&&file&&preview){
        const base64=preview.split(",")[1];
        messages=[{role:"user",content:[
          {type:"image",source:{type:"base64",media_type:file.type||"image/jpeg",data:base64}},
          {type:"text",text:`Analise esta nota fiscal brasileira. Retorne APENAS JSON válido sem markdown:\n{"tipo_nota":"","fornecedor":"razão social emitente","cnpj_fornecedor":"XX.XXX.XXX/XXXX-XX","numero_nf":"","serie":"","chave_acesso":"44 dígitos ou null","data_emissao":"DD/MM/AAAA","data_vencimento":"DD/MM/AAAA ou null","valor_total":"valor com vírgula","condicao_pagamento":"","descricao":"resumo dos itens"}`},
        ]}];
      } else {
        messages=[{role:"user",content:`Analise este XML de NF-e. Retorne APENAS JSON sem markdown:\n{"tipo_nota":"NF-e","fornecedor":"xNome emit","cnpj_fornecedor":"CNPJ formatado","numero_nf":"nNF","serie":"","chave_acesso":"44 dígitos","data_emissao":"DD/MM/AAAA","data_vencimento":"null","valor_total":"vNF","condicao_pagamento":"","descricao":"primeiros itens"}\n\nXML:\n${xmlText}`}];
      }
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,messages})});
      const data=await res.json();
      const text=(data.content??[]).map((b:any)=>b.text??"").join("");
      const parsed:NfFields=JSON.parse(text.replace(/```json|```/g,"").trim());
      addLog("✓ Dados extraídos com sucesso");

      // Auto-match credor pelo nome (Supabase)
      const match=matchCredor(parsed.fornecedor,credores);
      if(match){ setCreditorId(String(match.codigo)); setCreditorName(match.nome); addLog(`✓ Credor encontrado: ${match.nome} (ID: ${match.codigo})`); }
      else { addLog("⚠ Credor não encontrado na tabela — informe manualmente",false); }

      setFields(parsed); setStep("review");
    }catch(e:any){ addLog("Erro: "+e.message,false); setErrorMsg("Não foi possível ler a nota."); setStep("error"); }
  };

  // Buscar credor no Sienge por CNPJ (fallback)
  const buscarCredor = async()=>{
    if(!fields?.cnpj_fornecedor) return;
    const cnpj=fields.cnpj_fornecedor.replace(/\D/g,"");
    addLog(`Buscando credor (CNPJ ${cnpj}) no Sienge…`);
    try{
      const auth=btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
      const r=await fetch(`${SIENGE_BASE}/creditors?cpfCnpj=${cnpj}&limit=5`,{headers:{Authorization:`Basic ${auth}`,Accept:"application/json"}});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const d=await r.json(); const list=d.results??d.data??(Array.isArray(d)?d:[]);
      if(list.length>0){ setCreditorId(String(list[0].id)); setCreditorName(list[0].name??list[0].companyName??""); addLog(`✓ Encontrado: ${list[0].name} (ID: ${list[0].id})`); }
      else addLog("⚠ Não encontrado no Sienge",false);
    }catch(e:any){ addLog("⚠ Erro: "+e.message,false); }
  };

  const criarTitulo = async()=>{
    if(!creditorId||!fields) return;
    setStep("sending"); addLog("Criando título em Contas a Pagar…");
    const auth=btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
    const valor=parseBRL(fields.valor_total);
    const vencimento=fmtDate(fields.data_vencimento)??fmtDate(fields.data_emissao);
    const payload:Record<string,any>={
      creditorId:parseInt(creditorId,10),documentNumber:fields.numero_nf||"SN",
      issueDate:fmtDate(fields.data_emissao),netValue:valor,
      observation:fields.descricao??"",installments:[{dueDate:vencimento,value:valor}],
    };
    if(docTypeId) payload.documentTypeId=parseInt(docTypeId,10);
    try{
      const r=await fetch(`${SIENGE_BASE}/bills`,{method:"POST",headers:{Authorization:`Basic ${auth}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload)});
      const txt=await r.text(); let data:any={}; try{data=JSON.parse(txt);}catch{}
      if(r.ok||r.status===201){ addLog(`✓ Título criado! ID: ${data.id??data.billId??"—"}`); setResult(data); setStep("done"); }
      else{ addLog(`✗ Erro (${r.status}): ${txt}`,false); setErrorMsg(`Erro ${r.status}: ${txt.slice(0,240)}`); setStep("error"); }
    }catch(e:any){ addLog("✗ "+e.message,false); setErrorMsg("Falha: "+e.message); setStep("error"); }
  };

  const reset=()=>{ setStep("upload");setFile(null);setPreview(null);setXmlText("");setFields(null);setCreditorId("");setCreditorName("");setDocTypeId("");setResult(null);setErrorMsg("");setLog([]); };
  const upd=(k:keyof NfFields)=>(v:string)=>setFields(f=>f?{...f,[k]:v}:f);

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Inter',-apple-system,sans-serif",WebkitFontSmoothing:"antialiased" as any}}>
      <header style={{height:56,background:C.surface,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 24px",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 0 rgba(0,0,0,0.05)"}}>
        <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{height:36,objectFit:"contain"}}/>
        <div style={{position:"absolute",left:"50%",transform:"translateX(-50%)",display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:13,color:C.textMute}}>Financeiro /</span>
          <span style={{fontSize:14,fontWeight:600,color:C.text}}>OCR · Contas a Pagar</span>
        </div>
        {step!=="upload"&&<Btn variant="ghost" onClick={reset} style={{fontSize:12}}>← Nova nota</Btn>}
      </header>

      <div style={{maxWidth:860,margin:"0 auto",padding:"28px 20px"}}>
        {/* Steps */}
        <div style={{display:"flex",marginBottom:24,background:C.surface,borderRadius:10,border:`1px solid ${C.border}`,overflow:"hidden"}}>
          {(["upload","review","sending","done"] as Step[]).map((s,i)=>{
            const labels:Record<string,string>={upload:"1 · Upload",review:"2 · Revisão",sending:"3 · Enviando",done:"4 · Concluído"};
            const order=["upload","review","sending","done"];
            const cur=order.indexOf(["processing","error"].includes(step)?"upload":step);
            const idx=order.indexOf(s);
            return <div key={s} style={{flex:1,textAlign:"center",padding:"10px 0",fontSize:12,fontWeight:idx===cur?600:400,color:idx===cur?C.primary:idx<cur?C.success:C.textMute,borderBottom:`2px solid ${idx===cur?C.primary:idx<cur?C.success:"transparent"}`,borderRight:i<3?`1px solid ${C.border}`:undefined}}>{idx<cur?"✓ ":""}{labels[s]}</div>;
          })}
        </div>

        {/* UPLOAD */}
        {(step==="upload"||step==="processing")&&(
          <Card>
            <CardHeader title="Carregar Nota Fiscal" sub={`Credores do Supabase: ${credores.length}`}/>
            <div style={{padding:18}}>
              <div style={{display:"flex",gap:6,marginBottom:16}}>
                {(["image","xml"] as InputMode[]).map(m=>(
                  <button key={m} type="button" onClick={()=>setMode(m)} style={{height:32,padding:"0 14px",borderRadius:8,fontSize:12,fontWeight:500,cursor:"pointer",fontFamily:"inherit",background:mode===m?C.primaryBg:C.surface,color:mode===m?C.primary:C.textMid,border:`1px solid ${mode===m?C.primary:C.border}`}}>
                    {m==="image"?"📸  Foto / Imagem":"📄  XML da NF-e"}
                  </button>
                ))}
              </div>
              {mode==="image"?(
                <div onDrop={e=>{e.preventDefault();setDragOver(false);const f=e.dataTransfer.files[0];if(f)handleFile(f);}} onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onClick={()=>inputRef.current?.click()}
                  style={{border:`2px dashed ${dragOver?C.primary:file?C.success:C.borderMid}`,borderRadius:10,padding:"32px 20px",textAlign:"center",cursor:"pointer",background:dragOver?C.primaryBg:file?C.successBg:C.bg,minHeight:200,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,transition:"all .2s"}}>
                  <input ref={inputRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)handleFile(f);}}/>
                  {preview?(<><img src={preview} alt="NF" style={{maxHeight:180,maxWidth:"100%",borderRadius:6,objectFit:"contain",border:`1px solid ${C.border}`}}/><div style={{fontSize:13,color:C.success,fontWeight:600}}>✓ {file?.name}</div></>):(<><div style={{fontSize:36}}>📸</div><div style={{fontSize:14,color:C.textMid}}>Arraste a foto ou clique para selecionar</div><div style={{fontSize:12,color:C.textMute}}>JPG, PNG, HEIC</div></>)}
                </div>
              ):(
                <textarea value={xmlText} onChange={e=>setXmlText(e.target.value)} placeholder="Cole o XML da NF-e aqui…" style={{width:"100%",minHeight:200,padding:"10px 12px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:12,color:C.text,background:C.bg,fontFamily:"monospace",resize:"vertical",outline:"none",boxSizing:"border-box" as any}}/>
              )}
              {step==="processing"&&(
                <div style={{marginTop:16,background:C.bg,borderRadius:8,padding:"10px 14px"}}>
                  <div style={{fontSize:12,color:C.textMute,marginBottom:6}}>Processando…</div>
                  {log.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.ok?C.success:C.danger,padding:"2px 0"}}>{l.ts} · {l.msg}</div>)}
                </div>
              )}
              <div style={{marginTop:16,display:"flex",gap:10,alignItems:"center"}}>
                <Btn variant="accent" disabled={step==="processing"||(mode==="image"?!file:!xmlText.trim())} onClick={extractData}>
                  {step==="processing"?"Lendo…":"Extrair com IA →"}
                </Btn>
                <span style={{fontSize:12,color:C.textMute}}>Match automático com {credores.length} credores do Supabase</span>
              </div>
            </div>
          </Card>
        )}

        {/* REVIEW */}
        {step==="review"&&fields&&(
          <>
            <Card style={{marginBottom:16}}>
              <CardHeader title="Dados Extraídos — Revise se necessário"/>
              <div style={{padding:18,display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {fieldOrder.map(key=>(
                  <FieldInput key={key} label={fieldLabels[key]??key} value={fields[key]} onChange={upd(key)} wide={["chave_acesso","descricao","fornecedor"].includes(key)}/>
                ))}
              </div>
              {log.length>0&&<div style={{margin:"0 18px 14px",background:C.bg,borderRadius:8,padding:"10px 14px"}}>
                {log.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.ok?C.success:C.danger,padding:"2px 0"}}>{l.ts} · {l.msg}</div>)}
              </div>}
            </Card>
            <Card>
              <CardHeader title="Enviar para Sienge — Contas a Pagar" sub={`Tenant: ${SIENGE_TENANT} · ${SIENGE_USER}`}/>
              <div style={{padding:18}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase" as any,letterSpacing:"0.06em",marginBottom:4}}>ID do Credor *</div>
                    <div style={{display:"flex",gap:8}}>
                      <input value={creditorId} onChange={e=>setCreditorId(e.target.value)} placeholder="Ex: 5197" style={{flex:1,height:34,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surface,outline:"none",fontFamily:"inherit"}}/>
                      <Btn variant="default" onClick={buscarCredor} style={{fontSize:12}}>🔍 Buscar CNPJ</Btn>
                    </div>
                    {creditorName&&<div style={{fontSize:12,color:C.success,marginTop:4}}>✓ {creditorName}</div>}
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:C.textMute,textTransform:"uppercase" as any,letterSpacing:"0.06em",marginBottom:4}}>ID Tipo Documento (opcional)</div>
                    <input value={docTypeId} onChange={e=>setDocTypeId(e.target.value)} placeholder="Ex: 1" style={{width:"100%",height:34,padding:"0 10px",border:`1px solid ${C.border}`,borderRadius:8,fontSize:13,color:C.text,background:C.surface,outline:"none",fontFamily:"inherit",boxSizing:"border-box" as any}}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <Btn variant="accent" disabled={!creditorId} onClick={criarTitulo}>🚀 Criar Título no Sienge</Btn>
                  <span style={{fontSize:12,color:C.textMute}}>Lançado em Financeiro → Contas a Pagar</span>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* SENDING */}
        {step==="sending"&&(
          <Card><div style={{padding:48,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>📤</div>
            <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:8}}>Enviando para o Sienge…</div>
            {log.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.ok?C.success:C.danger}}>{l.ts} · {l.msg}</div>)}
          </div></Card>
        )}

        {/* DONE */}
        {step==="done"&&(
          <Card><div style={{padding:48,textAlign:"center"}}>
            <div style={{fontSize:48,marginBottom:12}}>✅</div>
            <div style={{fontSize:18,fontWeight:700,color:C.success,marginBottom:6}}>Título criado com sucesso!</div>
            <div style={{fontSize:13,color:C.textMid,marginBottom:20}}>Lançado em <strong>Financeiro → Contas a Pagar</strong> no Sienge</div>
            {result?.id&&<div style={{display:"inline-block",background:C.successBg,border:`1px solid ${C.success}`,borderRadius:8,padding:"8px 20px",fontSize:14,color:C.success,fontWeight:600,marginBottom:20}}>ID do Título: {result.id}</div>}
            <div style={{background:C.bg,borderRadius:8,padding:"10px 14px",marginBottom:24,textAlign:"left"}}>
              {log.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.ok?C.success:C.danger,padding:"2px 0"}}>{l.ts} · {l.msg}</div>)}
            </div>
            <Btn variant="accent" onClick={reset}>Processar nova nota</Btn>
          </div></Card>
        )}

        {/* ERROR */}
        {step==="error"&&(
          <Card><div style={{padding:40,textAlign:"center"}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontSize:16,fontWeight:700,color:C.danger,marginBottom:8}}>Ocorreu um erro</div>
            <div style={{fontSize:13,color:C.textMid,maxWidth:520,margin:"0 auto 20px"}}>{errorMsg}</div>
            {log.length>0&&<div style={{background:C.bg,borderRadius:8,padding:"10px 14px",marginBottom:20,textAlign:"left"}}>
              {log.map((l,i)=><div key={i} style={{fontSize:12,fontFamily:"monospace",color:l.ok?C.success:C.danger,padding:"2px 0"}}>{l.ts} · {l.msg}</div>)}
            </div>}
            <div style={{display:"flex",gap:10,justifyContent:"center"}}>
              <Btn variant="ghost" onClick={()=>{setStep("review");setErrorMsg("");}}>← Voltar</Btn>
              <Btn variant="accent" onClick={reset}>Começar do zero</Btn>
            </div>
          </div></Card>
        )}
      </div>
    </div>
  );
}

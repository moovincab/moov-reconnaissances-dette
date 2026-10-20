import {db,ok,fail,body,sha,q,validInk,record,fetchInstallments,audit,fmtCents,httpError} from './shared/core.mjs';
import {makePdf,amountWords} from './shared/pdf.mjs';
const key=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
async function find(t){const r=await db(`/rest/v1/records?sign_token_hash=eq.${sha(t)}&select=*&limit=1`);return r?.[0];}
export default async req=>{try{
 const b=req.method==='POST'?await body(req):null;
 const t=req.method==='GET'?new URL(req.url).searchParams.get('token'):b?.token;
 if(!key(t))return fail('Lien de signature invalide',404);
 const r=await find(t);if(!r)return fail('Lien de signature inconnu ou remplacé',404);
 if(r.state==='signed')return fail('Ce dossier a déjà été signé',409);
 if(r.state!=='pending'||!r.sign_expires_at||Date.parse(r.sign_expires_at)<Date.now())return fail('Lien expiré. Demandez un nouvel e-mail à votre gestionnaire.',410);
 const inst=await fetchInstallments(r.id);
 if(req.method==='GET'){
 const d={...r.data};delete d.creditor_signature;
 return ok({ref:r.ref,debtor_name:r.debtor_name,debtor_email:r.debtor_email,amount_cents:r.amount_cents,amount_words:amountWords(r.amount_cents),data:d,installments:inst.map(x=>({due_date:x.due_date,amount_cents:x.amount_cents})),expires_at:r.sign_expires_at});
 }
 if(req.method!=='POST')return fail('Méthode interdite',405);
 if(!b.accept||!validInk(b.mention)||!validInk(b.debtor))return fail('La mention manuscrite, la signature et l’accord explicite sont obligatoires');
 if((b.declared_name||'').trim().toLocaleLowerCase('fr')!==r.debtor_name.trim().toLocaleLowerCase('fr'))return fail('Veuillez saisir exactement votre nom et prénom comme indiqué dans le document');
 if((b.birth||'')!==r.data.debtor_birth)return fail('La date de naissance ne correspond pas au dossier');
 if(inst.reduce((s,x)=>s+x.amount_cents,0)!==r.amount_cents)return fail('Échéancier incohérent',409);
 const ip=(req.headers.get('x-nf-client-connection-ip')||req.headers.get('x-forwarded-for')||'').split(',')[0].trim().slice(0,64);
 const agent=(req.headers.get('user-agent')||'').slice(0,450);
 const date=new Date().toISOString();const sig={mention:b.mention,debtor:b.debtor};
 const bytes=await makePdf(r,inst,sig,{date,ip,agent});
 const path=`${r.id}/${r.ref}.pdf`;
 try{await db(`/storage/v1/object/debt-archives/${path}`,{method:'POST',data:bytes,headers:{'Content-Type':'application/pdf','x-upsert':'false'}});}catch(e){if(!String(e.message).includes('409'))throw e;return fail('Ce dossier est déjà en cours de signature. Contactez votre gestionnaire.',409);}
 const result=await db(`/rest/v1/records?id=eq.${r.id}&state=eq.pending&sign_token_hash=eq.${sha(t)}`,{method:'PATCH',data:{state:'signed',signed_at:date,sign_ip:ip,sign_user_agent:agent,signature:sig,pdf_path:`debt-archives/${path}`,pdf_sha256:sha(Buffer.from(bytes)),sign_token_hash:null,sign_expires_at:null,updated_at:date},headers:{Prefer:'return=representation'}});
 if(!result?.length)return fail('Ce dossier a été modifié pendant la signature. Contactez le gestionnaire.',409);
 try{await audit(r.id,'signed',null,{date,method:'simple_electronic_signature',ip,agent,pdf_sha256:result[0].pdf_sha256});}catch(err){console.error('Journal signature non enregistré',err);}
 return ok({signed:true,ref:r.ref});
 }catch(e){return httpError(e);}};

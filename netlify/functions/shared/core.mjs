import { createHash, randomBytes } from 'node:crypto';
const url=()=>process.env.SUPABASE_URL?.replace(/\/$/,'');
const secret=()=>process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
export const sha = t=>createHash('sha256').update(t).digest('hex');
export const token =()=>randomBytes(32).toString('hex');
export const uuid = s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s||''));
export const mail = s=>typeof s==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<255;
export const ok=(data, status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export const fail=(message,status=400)=>ok({error:message},status);
export function requestOrigin(req){return new URL(req.url).origin;}
export async function body(req){const length=Number(req.headers.get('content-length')||0);if(length>1500000)throw Error('Fichier ou signature trop volumineux');return await req.json();}
export async function db(path,opts={}){
 if(!url()||!secret())throw Error('Configuration Supabase absente');
 const {method='GET',data,headers={},raw=false}=opts;
 const h={'apikey':secret(),...(!secret().startsWith('sb_')?{'Authorization':`Bearer ${secret()}`}:{}) ,...headers};
 if(data!==undefined && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer))h['Content-Type']='application/json';
 const resp=await fetch(`${url()}${path}`,{method,headers:h,body:data===undefined?undefined:(data instanceof Uint8Array||data instanceof ArrayBuffer?data:JSON.stringify(data))});
 if(!resp.ok){const t=(await resp.text()).slice(0,350);throw Error(`Supabase ${resp.status}: ${t}`);}
 if(raw)return resp;
 if(resp.status===204)return null;
 const text=await resp.text();return text?JSON.parse(text):null;
}
export const q=v=>encodeURIComponent(v);
export async function checkUser(req){
 const match=/^Bearer (.+)$/.exec(req.headers.get('authorization')||'');if(!match)return null;
 const response=await fetch(`${url()}/auth/v1/user`,{headers:{'apikey':process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY||secret(),'Authorization':`Bearer ${match[1]}`}});
 if(!response.ok)return null;const user=await response.json();
 const members=await db(`/rest/v1/staff?user_id=eq.${q(user.id)}&active=eq.true&select=user_id,email,full_name,role&limit=1`);
 return members?.[0]||null;
}
export async function requireUser(req){const staff=await checkUser(req);if(!staff)throw Object.assign(new Error('Accès réservé aux salariés autorisés'),{status:401});return staff;}
export async function audit(id,event_type,by_user=null,details={}){await db('/rest/v1/events',{method:'POST',data:{record_id:id,event_type,by_user,details},headers:{Prefer:'return=minimal'}});}
export async function email(to,subject,html){
 if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)throw Error('Configuration des e-mails absente (RESEND_API_KEY, MAIL_FROM)');
 const resp=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.MAIL_FROM,to:[to],subject,html})});
 const result=await resp.json().catch(()=>({}));if(!resp.ok)throw Error('Envoi impossible : '+(result.message||resp.status));return result.id;
}
export const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export const fmtCents=n=>(Number(n)/100).toLocaleString('fr-FR',{style:'currency',currency:'EUR'});
export const fmtDate=s=>/^(\d{4})-(\d{2})-(\d{2})$/.test(s||'')?s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4):'—';
export async function record(id){const rows=await db(`/rest/v1/records?id=eq.${id}&select=*&limit=1`);return rows?.[0]||null;}
export async function fetchInstallments(id){return db(`/rest/v1/installments?record_id=eq.${id}&select=*&order=seq.asc`);}
export function validateDraft(b){
 const d=b.data||{}; const fields=['debtor_name','debtor_email','debtor_birth','debtor_address','vehicle','plate','contract_date','reason','place','creditor_name','creditor_address','creditor_siren','creditor_representative'];
 for(const f of fields){const value=(f==='debtor_name'?b.debtor_name:f==='debtor_email'?b.debtor_email:d[f]);if(!String(value||'').trim())throw Error('Champ obligatoire : '+f);if(String(value).length>500)throw Error('Champ trop long : '+f);}
 if(!mail(b.debtor_email))throw Error('Adresse e-mail du chauffeur incorrecte');
 if(!/^\d{9}$/.test(d.creditor_siren.replace(/\s/g,'')))throw Error('SIREN invalide');
 if(!Number.isSafeInteger(b.amount_cents)||b.amount_cents<100||b.amount_cents>10000000000)throw Error('Montant incorrect');
 if(!Array.isArray(b.schedule)||b.schedule.length<1||b.schedule.length>104)throw Error('Échéancier incorrect');
 let sum=0;for(const i of b.schedule){if(!/^\d{4}-\d{2}-\d{2}$/.test(i.due_date)||!Number.isSafeInteger(i.amount_cents)||i.amount_cents<=0)throw Error('Échéance invalide');sum+=i.amount_cents;}
 if(sum!==b.amount_cents)throw Error('Le total des échéances ne correspond pas au montant');
 if(d.creditor_signature && !validInk(d.creditor_signature))throw Error('Signature du créancier invalide');
 return d;
}
export function validInk(s){return typeof s==='string'&&s.startsWith('data:image/png;base64,')&&s.length>800&&s.length<700000&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s);}
export function httpError(e){console.error(e);return fail(e.status===401?'Session expirée ou compte non autorisé':e.status===403?'Accès interdit':e.message?.startsWith('Supabase')?'Erreur de base de données (voir journaux Netlify)':e.message||'Erreur interne',e.status||500);}

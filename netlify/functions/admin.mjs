import {db,ok,fail,body,requireUser,uuid,q,mail,token,sha,record,fetchInstallments,audit,email,fmtCents,fmtDate,escape,httpError} from './shared/core.mjs';
async function rows(){
 const path='/rest/v1/records?select=id,ref,created_by,assigned_to,state,debtor_email,debtor_name,amount_cents,data,sign_expires_at,invited_at,signed_at,pdf_path,pdf_sha256,created_at,updated_at,installments(*)&order=created_at.desc';
 let records=[],offset=0,part;
 do{part=await db(`${path}&limit=1000&offset=${offset}`);records.push(...part);offset+=part.length;}while(part.length===1000&&offset<20000);
 const people=await db('/rest/v1/staff?select=user_id,full_name,email,role,active&order=full_name.asc');return {records,people};
}
async function save(user,b){const {validateDraft}=await import('./shared/core.mjs');let data=validateDraft(b);
 if(b.assigned_to && !uuid(b.assigned_to))return fail('Responsable invalide');
 if(b.assigned_to){const st=await db(`/rest/v1/staff?user_id=eq.${b.assigned_to}&active=eq.true&select=user_id`);if(!st.length)return fail('Responsable non autorisé');}
 const base={debtor_email:b.debtor_email.toLowerCase().trim(),debtor_name:b.debtor_name.trim(),amount_cents:b.amount_cents,data,assigned_to:b.assigned_to||user.user_id,updated_at:new Date().toISOString()};
 let id=b.id;
 if(id){if(!uuid(id))return fail('Identifiant invalide');const old=await record(id);if(!old)return fail('Dossier introuvable',404);if(old.state!=='draft')return fail('Dossier déjà envoyé : il ne peut plus être modifié',409);const res=await db(`/rest/v1/records?id=eq.${id}&state=eq.draft`,{method:'PATCH',data:base,headers:{Prefer:'return=representation'}});if(!res.length)return fail('Dossier verrouillé',409);await db(`/rest/v1/installments?record_id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
 }else {const ref=`RDD-${new Date().getUTCFullYear()}-${Date.now().toString(36).toUpperCase()}-${token().slice(0,5).toUpperCase()}`;const res=await db('/rest/v1/records',{method:'POST',data:{...base,ref,created_by:user.user_id},headers:{Prefer:'return=representation'}});id=res[0].id;}
 try{await db('/rest/v1/installments',{method:'POST',data:b.schedule.map((x,i)=>({record_id:id,seq:i+1,due_date:x.due_date,amount_cents:x.amount_cents})),headers:{Prefer:'return=minimal'}});}catch(e){throw Error('Enregistrement des échéances impossible : '+e.message);}
 await audit(id,'draft_saved',user.user_id);return ok({id});}
async function invite(user,b){if(user.role!=='admin')return fail('Seul un administrateur peut inviter des salariés',403);if(!mail(b.email)||!String(b.full_name||'').trim())return fail('Nom ou e-mail invalide');
 const invite=await fetch(`${process.env.SUPABASE_URL.replace(/\/$/,'')}/auth/v1/invite`,{method:'POST',headers:{'apikey':process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,...(!(process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY).startsWith('sb_')?{Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY}`}:{ }),'Content-Type':'application/json'},body:JSON.stringify({email:b.email.trim().toLowerCase(),data:{full_name:b.full_name.trim()}})});
 const result=await invite.json().catch(()=>({}));if(!invite.ok||!uuid(result.id))return fail('Invitation impossible : '+(result.msg||result.message||'Compte existant ?'),400);
 await db('/rest/v1/staff?on_conflict=user_id',{method:'POST',data:{user_id:result.id,full_name:b.full_name.trim(),email:b.email.trim().toLowerCase(),role:'manager',active:true},headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
 return ok({sent:true});}
async function send(user,b,origin){if(!uuid(b.id))return fail('Identifiant invalide');const r=await record(b.id);if(!r)return fail('Dossier introuvable',404);if(!['draft','pending'].includes(r.state))return fail('Dossier déjà signé ou annulé',409);const inst=await fetchInstallments(r.id);if(!inst.length||inst.reduce((s,x)=>s+x.amount_cents,0)!==r.amount_cents)return fail('Échéancier incomplet',409);
 const raw=token(),valid=new Date(Date.now()+14*86400000).toISOString();
 const link=`${origin}/?sign=${raw}`;await db(`/rest/v1/records?id=eq.${r.id}`,{method:'PATCH',data:{state:'pending',sign_token_hash:sha(raw),sign_expires_at:valid,invited_at:new Date().toISOString()},headers:{Prefer:'return=minimal'}});
 try{await email(r.debtor_email,`Signature de votre reconnaissance de dette – ${r.ref}`,`<div style="font-family:Arial,sans-serif;max-width:600px"><h2>MOOV IN CAB</h2><p>Bonjour ${escape(r.debtor_name)},</p><p>Votre reconnaissance de dette de <strong>${escape(fmtCents(r.amount_cents))}</strong> est prête pour signature.</p><p>Veuillez prendre connaissance du document, recopier personnellement la mention demandée puis le signer en ligne.</p><p><a href="${link}" style="display:inline-block;padding:14px 22px;background:#101936;color:white;border-radius:6px">Consulter et signer</a></p><p>Ce lien personnel est valable jusqu'au ${fmtDate(valid.slice(0,10))}. Ne le partagez pas.</p><p>Si vous n'êtes pas concerné, ignorez cet e-mail et contactez MOOV IN CAB.</p></div>`);}catch(e){await db(`/rest/v1/records?id=eq.${r.id}`,{method:'PATCH',data:{state:'draft',sign_token_hash:null,sign_expires_at:null},headers:{Prefer:'return=minimal'}});throw e;}
 await audit(r.id,'invitation_sent',user.user_id,{recipient:r.debtor_email});return ok({sent:true});}
async function payment(user,b){if(!uuid(b.installment_id))return fail('Échéance invalide');const rows=await db(`/rest/v1/installments?id=eq.${b.installment_id}&select=id,record_id,paid_at&limit=1`);let i=rows?.[0];if(!i)return fail('Échéance inconnue',404);const r=await record(i.record_id);if(r?.state!=='signed')return fail('Document non signé',409);
 const val=b.paid?new Date().toISOString():null;
 await db(`/rest/v1/installments?id=eq.${i.id}`,{method:'PATCH',data:{paid_at:val,paid_note:b.paid?String(b.note||'').slice(0,250):null,updated_by:user.user_id},headers:{Prefer:'return=minimal'}});
 await audit(r.id,b.paid?'payment_marked':'payment_unmarked',user.user_id,{installment_id:i.id});return ok({saved:true});}
async function archive(id){if(!uuid(id))return fail('Identifiant invalide');const r=await record(id);if(!r?.pdf_path)return fail('PDF indisponible',404);const obj=await db(`/storage/v1/object/authenticated/${r.pdf_path}`,{raw:true});return new Response(obj.body,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${r.ref}.pdf"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export default async (req)=>{try{
 const user=await requireUser(req);const input=req.method==='POST'?await body(req):{};
 const action=req.method==='POST'?input.action:new URL(req.url).searchParams.get('action');
 if(action==='list')return ok(await rows());
 if(action==='save'&&req.method==='POST')return await save(user,input);
 if(action==='invite'&&req.method==='POST')return await invite(user,input);
 if(action==='send'&&req.method==='POST')return await send(user,input,new URL(req.url).origin);
 if(action==='payment'&&req.method==='POST')return await payment(user,input);
 if(action==='download'&&req.method==='GET')return await archive(new URL(req.url).searchParams.get('id'));
 if(action==='events'&&req.method==='GET'){
 const id=new URL(req.url).searchParams.get('id');if(!uuid(id))return fail('Identifiant invalide');
 const ev=await db(`/rest/v1/events?record_id=eq.${id}&select=event_type,occurred_at,details,by_user&order=occurred_at.desc&limit=100`);return ok({events:ev});}
 return fail('Action inconnue',404);
 }catch(e){return httpError(e);}};

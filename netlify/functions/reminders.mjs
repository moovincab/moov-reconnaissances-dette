import {db,email,fmtDate,fmtCents,escape} from './shared/core.mjs';
// Planifiée sur le déploiement principal de Netlify à 07:00 UTC (08:00/09:00 heure de Paris).
export default async ()=>{
 if(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM||!process.env.SITE_URL)throw Error('E-mail et SITE_URL non configurés');
 const today=new Date().toISOString().slice(0,10);
 const [items,people,already]=await Promise.all([
   db(`/rest/v1/installments?select=id,record_id,seq,due_date,amount_cents,paid_at,records!inner(ref,debtor_name,state,assigned_to)&paid_at=is.null&records.state=eq.signed&limit=1000`),
   db('/rest/v1/staff?select=user_id,full_name,email,active&active=eq.true&limit=500'),
   db('/rest/v1/reminder_logs?select=installment_id,reminder_type,recipient&limit=1000')
 ]);
 const owners=Object.fromEntries(people.map(p=>[p.user_id,p]));const sent=new Set(already.map(x=>`${x.installment_id}|${x.reminder_type}|${x.recipient}`));let groups=new Map();
 for(const i of items){
   const delta=Math.round((Date.parse(today+'T12:00:00Z')-Date.parse(i.due_date+'T12:00:00Z'))/86400000);
   if(!([-3,0,1].includes(delta)||(delta>=7&&delta%7===0)))continue;
   const type=delta===-3?'avant_3j':delta===0?'jour_j':delta===1?'retard_1j':`retard_${delta}j`;
   const user=owners[i.records?.assigned_to];if(!user?.email)continue;
   if(sent.has(`${i.id}|${type}|${user.email}`))continue;
   const entry={...i,type,delta,recipient:user.email,staff:user};
   groups.set(user.email,[...(groups.get(user.email)||[]),entry]);
 }
 let emails=0,notifications=0;
 for(const [recipient,entries] of groups){
   const person=entries[0].staff;
   const trs=entries.map(x=>`<tr><td style="padding:9px;border-bottom:1px solid #ddd">${escape(x.records.ref)}<br>${escape(x.records.debtor_name)}</td><td style="padding:9px;border-bottom:1px solid #ddd">${escape(fmtCents(x.amount_cents))}</td><td style="padding:9px;border-bottom:1px solid #ddd">${fmtDate(x.due_date)}</td><td style="padding:9px;border-bottom:1px solid #ddd">${x.delta<0?'Dans 3 jours':x.delta===0?'Aujourd’hui':`Retard ${x.delta} jour(s)`}</td></tr>`).join('');
   const html=`<div style="font-family:Arial,sans-serif;max-width:680px"><h2>Échéances à suivre – MOOV IN CAB</h2><p>Bonjour ${escape(person.full_name)},</p><p>Voici les échéances attribuées à votre compte nécessitant une vérification :</p><table style="border-collapse:collapse;width:100%"><thead><tr><th>Dossier</th><th>Montant</th><th>Échéance</th><th>Situation</th></tr></thead><tbody>${trs}</tbody></table><p>Marquez chaque échéance encaissée dans l’application pour arrêter les rappels.</p><p><a href="${process.env.SITE_URL}">Ouvrir le suivi</a></p></div>`;
   const id=await email(recipient,`MOOV IN CAB · ${entries.length} échéance(s) à suivre`,html);emails++;
   for(const x of entries){await db('/rest/v1/reminder_logs?on_conflict=installment_id,reminder_type,recipient',{method:'POST',data:{installment_id:x.id,reminder_type:x.type,recipient,resend_id:id},headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}});notifications++;}
 }
 console.log('Reminders',today,{emails,notifications});return new Response(JSON.stringify({emails,notifications}),{status:200});
};
export const config={schedule:'0 7 * * *'};

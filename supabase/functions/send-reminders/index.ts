import { adminClient, errorResponse, escapeHtml, getIp, json, sendEmail } from "../_shared/common.ts";
function dateOnlyUTC(d: Date) { return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); }
function fmtDate(s: string) { return new Date(`${s}T00:00:00Z`).toLocaleDateString("fr-FR",{timeZone:"UTC"}); }
function fmtMoney(n: number) { return new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR"}).format(n); }
function stageFor(daysUntil: number, stage: number, lastSent: string | null, now: Date): number | null {
  if (daysUntil > 0 && daysUntil <= 3 && stage < 1) return 1;
  if (daysUntil === 0 && stage < 2) return 2;
  if (daysUntil <= -1 && daysUntil > -7 && stage < 3) return 3;
  if (daysUntil <= -7 && daysUntil > -14 && stage < 4) return 4;
  if (daysUntil <= -14 && stage < 5) return 5;
  if (daysUntil < -14 && stage >= 5) {
    const last = lastSent ? new Date(lastSent).getTime() : 0;
    if (!last || now.getTime() - last >= 7 * 86400000) return 6;
  }
  return null;
}
const stageLabel: Record<number,string> = {1:"Échéance dans 3 jours",2:"Échéance aujourd'hui",3:"Échéance en retard (J+1)",4:"Échéance en retard (J+7)",5:"Échéance en retard (J+14)",6:"Rappel hebdomadaire — échéance en retard"};
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type,x-cron-secret"}});
  const expected = Deno.env.get("MOOV_CRON_SECRET");
  if (!expected || req.headers.get("x-cron-secret") !== expected) return json({error:"Non autorisé."},401);
  try {
    const db = adminClient(); const now = new Date(); const today = dateOnlyUTC(now);
    const horizon = new Date(today); horizon.setUTCDate(horizon.getUTCDate()+3);
    const { data: installments, error: instError } = await db.from("installments").select("id,debt_id,due_date,amount,reminder_stage,last_reminder_at").eq("status","pending").lte("due_date",horizon.toISOString().slice(0,10)).order("due_date").limit(1000);
    if (instError) throw new Error(instError.message);
    const debtIds = [...new Set((installments||[]).map((x:any)=>x.debt_id))];
    if (!debtIds.length) return json({ok:true,checked:0,sent:0,errors:[]});
    const { data: debts, error: debtError } = await db.from("debts").select("id,debtor_name,assigned_to,created_by,status,creditor_name").in("id",debtIds).in("status",["signed"]);
    if (debtError) throw new Error(debtError.message);
    const debtMap = new Map((debts||[]).map((d:any)=>[d.id,d]));
    const profileIds = [...new Set((debts||[]).map((d:any)=>d.assigned_to || d.created_by).filter(Boolean))];
    const { data: profiles, error: profileError } = profileIds.length ? await db.from("profiles").select("id,email,full_name").in("id",profileIds) : {data:[],error:null};
    if (profileError) throw new Error(profileError.message);
    const profileMap = new Map((profiles||[]).map((p:any)=>[p.id,p]));
    let sent = 0; const errors:string[] = [];
    for (const inst of (installments||[]) as any[]) {
      const debt:any = debtMap.get(inst.debt_id); if (!debt) continue;
      const due = dateOnlyUTC(new Date(`${inst.due_date}T00:00:00Z`));
      const daysUntil = Math.round((due.getTime()-today.getTime())/86400000);
      const stage = stageFor(daysUntil,Number(inst.reminder_stage||0),inst.last_reminder_at,now); if (!stage) continue;
      const recipient:any = profileMap.get(debt.assigned_to || debt.created_by);
      if (!recipient?.email) { errors.push(`Aucun e-mail responsable pour l'échéance ${inst.id}`); continue; }
      const subject = `MOOV IN CAB — ${stageLabel[stage]} : ${debt.debtor_name}`;
      const appUrl = Deno.env.get("APP_URL") || "";
      const html = `<p>Bonjour ${escapeHtml(recipient.full_name || "" )},</p><p><strong>${escapeHtml(stageLabel[stage])}</strong></p><p>Le dossier de <strong>${escapeHtml(debt.debtor_name)}</strong> comporte une échéance de <strong>${escapeHtml(fmtMoney(Number(inst.amount)))}</strong> prévue le ${escapeHtml(fmtDate(inst.due_date))}.</p><p>Connectez-vous à l'application MOOV IN CAB pour consulter le dossier et mettre à jour le paiement. Le rappel s'arrêtera lorsque l'échéance sera marquée comme payée.</p>${appUrl ? `<p><a href="${escapeHtml(appUrl)}">Ouvrir MOOV IN CAB</a></p>` : ""}`;
      try {
        await sendEmail(recipient.email,subject,html,`${stageLabel[stage]} : ${debt.debtor_name}; ${fmtMoney(Number(inst.amount))}; échéance du ${fmtDate(inst.due_date)}.`);
        await db.from("installments").update({reminder_stage:stage,last_reminder_at:now.toISOString()}).eq("id",inst.id).eq("status","pending");
        sent++;
      } catch (e) { errors.push(`${inst.id}: ${e instanceof Error ? e.message : "Erreur d'envoi"}`); }
    }
    return json({ok:true,checked:(installments||[]).length,sent,errors});
  } catch (e) { return errorResponse(e,500); }
});

import { errorResponse, escapeHtml, json, preflight, requireUser, randomToken, sha256, sendEmail, amountFr } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({error:"Méthode non autorisée."},405);
  try {
    const {db} = await requireUser(req);
    const {debt_id} = await req.json();
    if (typeof debt_id !== "string") throw new Error("Identifiant de dossier invalide.");
    const {data:debt,error} = await db.from("debts").select("id,debtor_name,debtor_email,amount,status").eq("id",debt_id).single();
    if (error || !debt) throw new Error("Dossier introuvable.");
    if (debt.status !== "pending_signature") throw new Error("Ce dossier n'est plus en attente de signature.");
    const now = new Date().toISOString();
    await db.from("signature_requests").update({expires_at:now}).eq("debt_id",debt.id).is("signed_at",null);
    const token = randomToken();
    const expiresAt = new Date(Date.now()+14*86400000).toISOString();
    const {error:insertError} = await db.from("signature_requests").insert({debt_id:debt.id,token_hash:await sha256(token),expires_at:expiresAt});
    if (insertError) throw new Error(insertError.message);
    const appUrl = Deno.env.get("APP_URL"); if(!appUrl) throw new Error("Le secret APP_URL n'est pas configuré.");
    const link = `${appUrl.replace(/\/$/, "/")}?signature=${token}`;
    await sendEmail(debt.debtor_email,"MOOV IN CAB — Nouveau lien de signature",
      `<p>Bonjour ${escapeHtml(debt.debtor_name)},</p><p>Voici un nouveau lien pour consulter et signer la reconnaissance de dette de <strong>${escapeHtml(amountFr(debt.amount))}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#176b87;color:#fff;text-decoration:none;border-radius:8px">Consulter et signer</a></p><p>Ce lien expire dans 14 jours. Les anciens liens non utilisés ont été désactivés.</p>`,
      `Bonjour ${debt.debtor_name}, nouveau lien pour signer une reconnaissance de dette de ${amountFr(debt.amount)} : ${link}. Ce lien expire dans 14 jours.`);
    return json({ok:true,message:"Nouveau lien envoyé au débiteur."});
  } catch(e) { return errorResponse(e); }
});

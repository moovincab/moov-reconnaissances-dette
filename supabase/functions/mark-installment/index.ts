import { errorResponse, json, preflight, requireUser } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error:"Méthode non autorisée." },405);
  try {
    const { db } = await requireUser(req);
    const { installment_id, paid } = await req.json();
    if (typeof installment_id !== "string" || typeof paid !== "boolean") throw new Error("Paramètres invalides.");
    const { data: installment, error: lookupError } = await db.from("installments").select("id,debt_id").eq("id",installment_id).single();
    if (lookupError || !installment) throw new Error("Échéance introuvable.");
    const { data: debt, error: debtLookupError } = await db.from("debts").select("id,status").eq("id",installment.debt_id).single();
    if (debtLookupError || !debt) throw new Error("Dossier associé introuvable.");
    if (debt.status === "pending_signature") throw new Error("Le dossier doit être signé avant de modifier les paiements.");
    const { error } = await db.from("installments").update({ status:paid?"paid":"pending", paid_at:paid?new Date().toISOString():null }).eq("id",installment_id);
    if (error) throw new Error(error.message);
    if (paid) {
      const { count } = await db.from("installments").select("id",{count:"exact",head:true}).eq("debt_id",installment.debt_id).eq("status","pending");
      if ((count ?? 1) === 0) await db.from("debts").update({status:"repaid",updated_at:new Date().toISOString()}).eq("id",installment.debt_id);
    } else {
      await db.from("debts").update({status:"signed",updated_at:new Date().toISOString()}).eq("id",installment.debt_id).eq("status","repaid");
    }
    return json({ok:true});
  } catch (e) { return errorResponse(e); }
});

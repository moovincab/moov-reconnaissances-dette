import { adminClient, errorResponse, json, preflight, sha256 } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const { token } = await req.json();
    if (typeof token !== "string" || token.length < 40 || token.length > 200) throw new Error("Lien de signature invalide.");
    const db = adminClient();
    const { data: request, error } = await db.from("signature_requests").select("id,debt_id,expires_at,signed_at").eq("token_hash", await sha256(token)).maybeSingle();
    if (error || !request) throw new Error("Lien de signature inconnu ou invalide.");
    if (request.signed_at) return json({ signed: true, message: "Ce document a déjà été signé." });
    if (new Date(request.expires_at).getTime() < Date.now()) throw new Error("Ce lien de signature a expiré. Contactez MOOV IN CAB pour recevoir un nouveau lien.");
    const { data: debt, error: debtError } = await db.from("debts").select("id,creditor_name,creditor_address,debtor_name,debtor_address,amount,amount_in_words,reason,frequency,installment_count,status,created_at").eq("id", request.debt_id).single();
    if (debtError || !debt) throw new Error("Document introuvable.");
    const { data: installments } = await db.from("installments").select("sequence_no,due_date,amount").eq("debt_id", debt.id).order("sequence_no");
    return json({ signed: false, expires_at: request.expires_at, debt, installments: installments || [] });
  } catch (e) { return errorResponse(e); }
});

import { canAccessDebt, errorResponse, json, preflight, requireUser } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error:"Méthode non autorisée." },405);
  try {
    const { db, user, profile } = await requireUser(req);
    const { debt_id } = await req.json();
    if (typeof debt_id !== "string") throw new Error("Identifiant du dossier invalide.");
    const { data: debt, error } = await db.from("debts").select("created_by,assigned_to,signed_pdf_path,status").eq("id",debt_id).single();
    if (error || !debt || !canAccessDebt(profile, user.id, debt) || !debt.signed_pdf_path || debt.status === "pending_signature") throw new Error("PDF signé introuvable ou accès non autorisé.");
    const { data, error: urlError } = await db.storage.from("signed-debt-documents").createSignedUrl(debt.signed_pdf_path,60);
    if (urlError || !data?.signedUrl) throw new Error("Impossible de créer le lien de téléchargement.");
    return json({url:data.signedUrl});
  } catch (e) { return errorResponse(e); }
});

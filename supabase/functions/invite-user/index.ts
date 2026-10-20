import { errorResponse, json, preflight, requireUser } from "../_shared/common.ts";
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const { db, profile } = await requireUser(req);
    if (profile.role !== "admin") throw new Error("Seul un administrateur peut inviter un membre.");
    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const fullName = String(body.full_name || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) throw new Error("Nom complet et adresse e-mail valides obligatoires.");
    const appUrl = Deno.env.get("APP_URL");
    if (!appUrl) throw new Error("Le secret APP_URL n'est pas configuré.");
    const { data, error } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl, data: { full_name: fullName, role: "staff" } });
    if (error) throw new Error(error.message);
    return json({ ok:true, user_id:data.user?.id, message:"Invitation envoyée. Vérifiez aussi la configuration e-mail d'authentification de Supabase." });
  } catch (e) { return errorResponse(e); }
});

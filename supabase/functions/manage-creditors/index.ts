import { errorResponse, json, preflight, requireUser } from "../_shared/common.ts";

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const { db, user } = await requireUser(req);
    const body = await req.json();
    const action = String(body.action || "list");

    if (action === "list") {
      const { data, error } = await db.from("creditors")
        .select("id,name,address,siren,representative,is_default,created_at")
        .order("is_default", { ascending: false }).order("name", { ascending: true });
      if (error) throw new Error(`Impossible de charger les créanciers : ${error.message}`);
      return json({ creditors: data || [] });
    }

    if (action !== "create") throw new Error("Action non reconnue.");
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    const siren = String(body.siren || "").replace(/\s/g, "").trim();
    const representative = String(body.representative || "").trim();
    if (!name || name.length > 180) throw new Error("Le nom du créancier est obligatoire (180 caractères maximum).");
    if (!address || address.length > 500) throw new Error("L'adresse du créancier est obligatoire (500 caractères maximum).");
    if (siren && !/^\d{9}$/.test(siren)) throw new Error("Le SIREN doit contenir exactement 9 chiffres.");
    if (representative.length > 250) throw new Error("Le représentant est trop long (250 caractères maximum).");

    const { data: existing, error: existingError } = await db.from("creditors")
      .select("id,name,address,siren,representative,is_default,created_at")
      .eq("name", name).eq("address", address).eq("siren", siren).eq("representative", representative).limit(1).maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing) return json({ creditor: existing, existing: true });

    const { data, error } = await db.from("creditors").insert({
      name, address, siren, representative, is_default: false, created_by: user.id,
    }).select("id,name,address,siren,representative,is_default,created_at").single();
    if (error || !data) throw new Error(error?.message || "Impossible d'enregistrer le créancier.");
    return json({ creditor: data, existing: false });
  } catch (e) { return errorResponse(e); }
});

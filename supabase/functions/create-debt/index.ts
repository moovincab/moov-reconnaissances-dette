import { errorResponse, escapeHtml, json, preflight, requireUser, randomToken, sha256, sendEmail, amountFr, amountInFrenchWords } from "../_shared/common.ts";

function addMonths(date: Date, months: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return result.toISOString().slice(0, 10);
}
function addWeeks(date: Date, weeks: number) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + 7 * weeks); return d.toISOString().slice(0, 10); }
function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const { db, user, profile } = await requireUser(req);
    const body = await req.json();
    const debtor_name = String(body.debtor_name || "").trim();
    const debtor_email = String(body.debtor_email || "").trim().toLowerCase();
    const debtor_phone = String(body.debtor_phone || "").trim();
    const debtor_address = String(body.debtor_address || "").trim();
    const vehicle = String(body.vehicle || "").trim();
    const vehicle_registration = String(body.vehicle_registration || "").trim().toUpperCase();
    const rental_contract_signed_at = String(body.rental_contract_signed_at || "");
    const amount = Math.round(Number(body.amount) * 100) / 100;
    const amount_in_words = amountInFrenchWords(amount);
    const reason = String(body.reason || "Loyers impayés").trim().slice(0, 3000) || "Loyers impayés";
    const repayment_mode = body.repayment_mode === "cash" ? "cash" : body.repayment_mode === "installments" ? "installments" : "";
    const firstDue = String(body.first_due_date || "");
    const cashDue = String(body.cash_due_date || "");
    const frequency = body.frequency === "monthly" ? "monthly" : body.frequency === "weekly" ? "weekly" : "";
    const count = Number(body.installment_count);

    if (!debtor_name || debtor_name.length > 180 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debtor_email)) throw new Error("Nom du débiteur et e-mail valide obligatoires.");
    if (!debtor_phone || debtor_phone.length > 80) throw new Error("Le téléphone du débiteur est obligatoire.");
    if (!debtor_address || debtor_address.length > 1000) throw new Error("L'adresse du débiteur est obligatoire.");
    if (!vehicle || vehicle.length > 180 || !vehicle_registration || vehicle_registration.length > 30) throw new Error("Le véhicule et son immatriculation sont obligatoires.");
    if (!validDateOnly(rental_contract_signed_at)) throw new Error("Date de signature du contrat de location invalide.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw new Error("Montant invalide.");
    if (!repayment_mode) throw new Error("Choisissez un mode de remboursement.");
    if (repayment_mode === "cash" && !validDateOnly(cashDue)) throw new Error("La date limite de paiement comptant est obligatoire.");
    if (repayment_mode === "installments" && (!validDateOnly(firstDue) || !frequency || !Number.isInteger(count) || count < 1 || count > 60)) {
      throw new Error("Fréquence, première échéance ou nombre d'échéances invalide (1 à 60).");
    }

    const requestedAssignedTo = String(body.assigned_to || user.id);
    if (profile.role !== "admin" && requestedAssignedTo !== user.id) throw new Error("Seul un administrateur peut attribuer un dossier à un autre collaborateur.");
    const assignedTo = profile.role === "admin" ? requestedAssignedTo : user.id;
    const { data: assignee } = await db.from("profiles").select("id").eq("id", assignedTo).maybeSingle();
    if (!assignee) throw new Error("Responsable de rappel introuvable.");

    const creditorId = String(body.creditor_id || "");
    let creditor: any = null;
    if (creditorId) {
      const { data, error } = await db.from("creditors").select("id,name,address,siren,representative,is_default").eq("id", creditorId).maybeSingle();
      if (error || !data) throw new Error("Le créancier sélectionné est introuvable. Rechargez la liste des créanciers.");
      creditor = data;
    } else {
      const { data, error } = await db.from("creditors").select("id,name,address,siren,representative,is_default").eq("is_default", true).maybeSingle();
      if (error || !data) throw new Error("Le créancier par défaut n'est pas configuré. Exécutez la migration des créanciers.");
      creditor = data;
    }

    const storedFrequency = repayment_mode === "cash" ? "monthly" : frequency;
    const storedCount = repayment_mode === "cash" ? 1 : count;
    const { data: debt, error: debtError } = await db.from("debts").insert({
      created_by: user.id, assigned_to: assignedTo,
      creditor_id: creditor.id,
      creditor_name: creditor.name,
      creditor_address: creditor.address,
      creditor_siren: creditor.siren || "",
      creditor_representative: creditor.representative || "",
      debtor_name, debtor_email, debtor_phone, debtor_address,
      vehicle, vehicle_registration, rental_contract_signed_at,
      amount, amount_in_words, reason, repayment_mode,
      cash_due_date: repayment_mode === "cash" ? cashDue : null,
      frequency: storedFrequency, installment_count: storedCount, status: "pending_signature",
    }).select("id,debtor_name,debtor_email,amount,amount_in_words").single();
    if (debtError || !debt) throw new Error(debtError?.message || "Impossible de créer le dossier.");

    let rows: Array<{debt_id:string;sequence_no:number;due_date:string;amount:number}>;
    if (repayment_mode === "cash") {
      rows = [{ debt_id: debt.id, sequence_no: 1, due_date: cashDue, amount }];
    } else {
      const totalCents = Math.round(amount * 100);
      const baseCents = Math.floor(totalCents / count);
      const remainder = totalCents - baseCents * count;
      const start = new Date(`${firstDue}T00:00:00Z`);
      rows = Array.from({ length: count }, (_, i) => ({
        debt_id: debt.id, sequence_no: i + 1,
        due_date: frequency === "weekly" ? addWeeks(start, i) : addMonths(start, i),
        amount: (baseCents + (i < remainder ? 1 : 0)) / 100,
      }));
    }
    const { error: installmentsError } = await db.from("installments").insert(rows);
    if (installmentsError) {
      await db.from("debts").delete().eq("id", debt.id);
      throw new Error(`Échéancier non créé : ${installmentsError.message}`);
    }

    const token = randomToken();
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const { error: tokenError } = await db.from("signature_requests").insert({ debt_id: debt.id, token_hash: await sha256(token), expires_at: expiresAt });
    if (tokenError) throw new Error(`Dossier créé mais lien de signature non préparé : ${tokenError.message}`);
    const appUrl = Deno.env.get("APP_URL");
    if (!appUrl) throw new Error("Dossier créé mais le secret APP_URL n'est pas configuré.");
    const link = `${appUrl.replace(/\?$/, "").replace(/\/$/, "/")}?signature=${token}`;
    let emailSent = true; let emailWarning = "";
    try {
      await sendEmail(debtor_email, "MOOV IN CAB — Signature d'une reconnaissance de dette",
        `<p>Bonjour ${escapeHtml(debtor_name)},</p><p>MOOV IN CAB vous invite à consulter et signer électroniquement une reconnaissance de dette d'un montant de <strong>${escapeHtml(amountFr(amount))}</strong>.</p><p><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 18px;background:#176b87;color:#fff;text-decoration:none;border-radius:8px">Consulter et signer</a></p><p>Ce lien expire le ${new Date(expiresAt).toLocaleDateString("fr-FR")}.</p><p>Si vous pensez avoir reçu ce message par erreur, contactez MOOV IN CAB sans signer le document.</p>`,
        `Bonjour ${debtor_name}, MOOV IN CAB vous invite à signer une reconnaissance de dette de ${amountFr(amount)}. Lien : ${link}. Ce lien expire dans 14 jours.`);
    } catch (e) { emailSent = false; emailWarning = e instanceof Error ? e.message : "Erreur d'envoi e-mail"; }
    return json({ ok: true, debt_id: debt.id, emailSent, emailWarning: emailSent ? undefined : emailWarning });
  } catch (e) { return errorResponse(e); }
});

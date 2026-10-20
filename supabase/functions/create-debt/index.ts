import { adminClient, errorResponse, escapeHtml, json, preflight, requireUser, randomToken, sha256, sendEmail, amountFr } from "../_shared/common.ts";

function addMonths(date: Date, months: number) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return result.toISOString().slice(0, 10);
}
function addWeeks(date: Date, weeks: number) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + 7 * weeks); return d.toISOString().slice(0, 10); }
Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const { db, user, profile } = await requireUser(req);
    const body = await req.json();
    const debtor_name = String(body.debtor_name || "").trim();
    const debtor_email = String(body.debtor_email || "").trim().toLowerCase();
    const amount = Math.round(Number(body.amount) * 100) / 100;
    const amount_in_words = String(body.amount_in_words || "").trim();
    const reason = String(body.reason || "").trim();
    const firstDue = String(body.first_due_date || "");
    const frequency = body.frequency === "monthly" ? "monthly" : body.frequency === "weekly" ? "weekly" : "";
    const count = Number(body.installment_count);
    if (!debtor_name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(debtor_email)) throw new Error("Nom du débiteur et e-mail valide obligatoires.");
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw new Error("Montant invalide.");
    if (!amount_in_words || amount_in_words.length > 250) throw new Error("Le montant en toutes lettres est obligatoire.");
    if (!reason || reason.length > 3000) throw new Error("Le motif de la dette est obligatoire (3 000 caractères maximum).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDue) || Number.isNaN(Date.parse(`${firstDue}T00:00:00Z`))) throw new Error("Date de première échéance invalide.");
    if (!frequency || !Number.isInteger(count) || count < 1 || count > 60) throw new Error("Fréquence ou nombre d'échéances invalide (1 à 60).");
    const assignedTo = String(body.assigned_to || user.id);
    const { data: assignee } = await db.from("profiles").select("id").eq("id", assignedTo).maybeSingle();
    if (!assignee) throw new Error("Responsable de rappel introuvable.");
    const { data: debt, error: debtError } = await db.from("debts").insert({
      created_by: user.id, assigned_to: assignedTo,
      creditor_name: String(body.creditor_name || "MOOV IN CAB").trim().slice(0, 180),
      creditor_address: String(body.creditor_address || "").trim().slice(0, 500),
      debtor_name, debtor_email, debtor_address: String(body.debtor_address || "").trim().slice(0, 1000),
      amount, amount_in_words, reason, frequency, installment_count: count, status: "pending_signature",
    }).select("id,debtor_name,debtor_email,amount,amount_in_words").single();
    if (debtError || !debt) throw new Error(debtError?.message || "Impossible de créer le dossier.");

    const totalCents = Math.round(amount * 100);
    const baseCents = Math.floor(totalCents / count);
    const remainder = totalCents - baseCents * count;
    const start = new Date(`${firstDue}T00:00:00Z`);
    const rows = Array.from({ length: count }, (_, i) => ({
      debt_id: debt.id, sequence_no: i + 1,
      due_date: frequency === "weekly" ? addWeeks(start, i) : addMonths(start, i),
      amount: (baseCents + (i < remainder ? 1 : 0)) / 100,
    }));
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

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { adminClient, amountInFrenchWords, errorResponse, getIp, json, preflight, sha256 } from "../_shared/common.ts";

function dataUrlBytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,") || value.length > 1500000) throw new Error(`${label} est invalide ou trop volumineux.`);
  const raw = atob(value.slice("data:image/png;base64,".length));
  if (raw.length < 100) throw new Error(`${label} semble vide.`);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function safePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,"-")
    .replace(/œ/g,"oe").replace(/Œ/g,"OE").replace(/[\u00a0\u202f]/g," ")
    .replace(/…/g,"...").replace(/☐/g,"[ ]").replace(/☒/g,"[X]")
    .replace(/[\r\n]+/g," ").trim();
}
function fmtMoney(n: number) { return new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR" }).format(n); }
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const value = String(d).slice(0,10);
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("fr-FR", { timeZone:"UTC" });
}
function legacyAmountWords(debt: any) { return amountInFrenchWords(Number(debt.amount)); }

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);
  try {
    const body = await req.json();
    const token = body.token;
    const dob = String(body.debtor_dob || "");
    if (typeof token !== "string" || token.length < 40) throw new Error("Lien de signature invalide.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(`${dob}T00:00:00Z`))) throw new Error("Date de naissance invalide.");
    if (body.accepted !== true) throw new Error("Vous devez confirmer votre accord avant de signer.");
    const mentionBytes = dataUrlBytes(body.mention_png, "Mention manuscrite");
    const signatureBytes = dataUrlBytes(body.signature_png, "Signature");
    const db = adminClient();
    const { data: reqRow, error: reqError } = await db.from("signature_requests").select("id,debt_id,expires_at,signed_at").eq("token_hash", await sha256(token)).maybeSingle();
    if (reqError || !reqRow) throw new Error("Lien de signature invalide.");
    if (reqRow.signed_at) throw new Error("Ce document a déjà été signé.");
    if (new Date(reqRow.expires_at).getTime() < Date.now()) throw new Error("Le lien de signature a expiré.");
    const { data: debt, error: debtError } = await db.from("debts").select("*").eq("id", reqRow.debt_id).single();
    if (debtError || !debt) throw new Error("Document introuvable.");
    if (debt.status !== "pending_signature") throw new Error("Ce document n'est plus en attente de signature.");
    const { data: installments, error: insError } = await db.from("installments").select("sequence_no,due_date,amount").eq("debt_id", debt.id).order("sequence_no");
    if (insError) throw new Error("Impossible de charger l'échéancier.");

    const signedAt = new Date().toISOString();
    const ip = getIp(req) || "non communiquée par le proxy";
    const userAgent = (req.headers.get("user-agent") || "non communiqué").slice(0,500);
    const mentionSha = await sha256(mentionBytes);
    const signatureSha = await sha256(signatureBytes);
    const amountWords = legacyAmountWords(debt);
    const paymentMode = debt.repayment_mode === "cash" ? "cash" : "installments";
    const creditorName = debt.creditor_name || "MOOV IN CAB";
    const creditorAddress = debt.creditor_address || "1 Place Paul Verlaine, 92100 Boulogne-Billancourt";
    const creditorSiren = debt.creditor_siren || "494179377";
    const creditorRepresentative = debt.creditor_representative || "M. Nicolas VEDOVATO, en qualité de représentant légal";
    const debtorAddress = debt.debtor_address || "—";
    const debtorPhone = debt.debtor_phone || "—";
    const vehicle = debt.vehicle || "—";
    const vehicleRegistration = debt.vehicle_registration || "—";
    const reasonDetail = debt.reason && !/^loyers impayés$/i.test(String(debt.reason).trim()) ? String(debt.reason) : "";
    const contractPayload = {
      version: 1,
      debt_id: debt.id,
      creditor: { name: creditorName, address: creditorAddress, siren: creditorSiren, representative: creditorRepresentative },
      debtor: { name: debt.debtor_name, dob, address: debtorAddress, phone: debtorPhone },
      rental: { vehicle, registration: vehicleRegistration, contract_signed_at: debt.rental_contract_signed_at || null, reason_detail: reasonDetail },
      amount: Number(debt.amount), amount_words: amountWords,
      repayment: { mode: paymentMode, cash_due_date: debt.cash_due_date || null, installments: installments || [] },
      signed_at: signedAt, ip, user_agent: userAgent,
      mention_png_sha256: mentionSha, signature_png_sha256: signatureSha,
    };
    const contractDigest = await sha256(JSON.stringify(contractPayload));

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Reconnaissance de dette - ${safePdfText(debt.debtor_name)}`);
    pdf.setAuthor(safePdfText(debt.creditor_name));
    pdf.setSubject("Reconnaissance de dette signée électroniquement");
    pdf.setKeywords(["reconnaissance de dette", "MOOV IN CAB", "signature électronique", "SHA-256"]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.06,0.16,0.26), blue = rgb(0.09,0.42,0.53), muted = rgb(0.35,0.42,0.49), lineColor = rgb(0.75,0.8,0.84);
    const pageSize: [number, number] = [595.28,841.89];
    let page = pdf.addPage(pageSize), y = 795;
    const left = 48, maxWidth = 499;
    const addPage = () => { page = pdf.addPage(pageSize); y = 795; };
    const ensureSpace = (height: number) => { if (y - height < 48) addPage(); };
    const line = (value: string, size = 10, isBold = false, color = navy, indent = 0) => {
      ensureSpace(size + 8);
      page.drawText(safePdfText(value), { x:left + indent, y, size, font:isBold ? bold : font, color });
      y -= size + 6;
    };
    const paragraph = (value: string, size = 10, gap = 4, indent = 0) => {
      const text = safePdfText(value); if (!text) { y -= gap; return; }
      const words = text.split(/\s+/); let current = "";
      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth - indent && current) {
          ensureSpace(size + 8); line(current, size, false, navy, indent); current = word;
        } else current = candidate;
      }
      if (current) line(current, size, false, navy, indent);
      y -= gap;
    };
    const heading = (value: string) => { y -= 3; ensureSpace(26); line(value, 12, true, blue); };
    const bullet = (value: string) => paragraph(`- ${value}`, 10, 2, 8);
    const imageBox = async (label: string, bytes: Uint8Array, maxHeight: number) => {
      const boxHeight = maxHeight + 14;
      ensureSpace(boxHeight + 28);
      line(label, 10, true, navy);
      const bottom = y - boxHeight + 5;
      page.drawRectangle({ x:left, y:bottom, width:maxWidth, height:boxHeight, borderColor:lineColor, borderWidth:0.8 });
      const img = await pdf.embedPng(bytes);
      const scale = Math.min((maxWidth - 12) / img.width, (boxHeight - 10) / img.height);
      const w = img.width * scale, h = img.height * scale;
      page.drawImage(img, { x:left + 6 + (maxWidth - 12 - w) / 2, y:bottom + 5 + (boxHeight - 10 - h) / 2, width:w, height:h });
      y = bottom - 14;
    };

    line("RECONNAISSANCE DE DETTE", 18, true, navy);
    y -= 2;
    paragraph("Entre les soussignés :", 10, 5);
    line("Le créancier :", 11, true, navy);
    paragraph(`Société : ${creditorName}`);
    paragraph(`Adresse : ${creditorAddress}`);
    paragraph(`SIREN : ${creditorSiren}`);
    paragraph(`Représentée par : ${creditorRepresentative}`, 10, 6);
    line("Et", 10, false, navy);
    line("Le débiteur :", 11, true, navy);
    paragraph(`Nom et prénom : ${debt.debtor_name}`);
    paragraph(`Date de naissance : ${fmtDate(dob)}`);
    paragraph(`Adresse : ${debtorAddress}`);
    paragraph(`Téléphone : ${debtorPhone}`, 10, 8);

    heading("Article 1 — Objet");
    paragraph(`Je soussigné(e), ${debt.debtor_name}, reconnais devoir à la société « ${debt.creditor_name || "MOOV IN CAB"} » la somme de :`);
    line(`${fmtMoney(Number(debt.amount))} (${amountWords})`, 12, true, navy);
    paragraph("au titre de loyers impayés, liés au contrat de location du véhicule :");
    paragraph(`Véhicule : ${vehicle}`);
    paragraph(`Immatriculation : ${vehicleRegistration}`);
    paragraph(`Contrat de location signé le : ${fmtDate(debt.rental_contract_signed_at)}`, 10, 5);
    if (reasonDetail) paragraph(`Précision complémentaire : ${reasonDetail}`, 9, 5);

    heading("Article 2 — Modalités de remboursement");
    paragraph("Le débiteur s'engage à rembourser la dette selon les modalités suivantes :");
    if (paymentMode === "cash") {
      paragraph(`[X] Paiement comptant au plus tard le : ${fmtDate(debt.cash_due_date)}`);
      line("OU", 10, false, navy);
      paragraph("[ ] Paiement échelonné");
    } else {
      paragraph("[ ] Paiement comptant au plus tard le : ___ / ___ / _____");
      line("OU", 10, false, navy);
      const count = (installments || []).length;
      const countWords = amountInFrenchWords(count).replace(/\s+euros?.*$/i, "");
      paragraph(`[X] Paiement échelonné : en ${count} (${countWords}) fois,`);
      for (const inst of (installments || [])) bullet(`${fmtMoney(Number(inst.amount))} le ${fmtDate(inst.due_date)}`);
      paragraph("par virement bancaire sur le compte du créancier ;", 10, 5);
    }

    heading("Article 3 — Défaut de paiement");
    paragraph("En cas de non-respect d'une échéance :");
    bullet("la totalité de la somme restante deviendra immédiatement exigible ;");
    bullet("le créancier pourra engager toute procédure de recouvrement judiciaire.");
    paragraph("Les frais de recouvrement seront à la charge du débiteur.", 10, 5);

    heading("Article 4 — Reconnaissance expresse");
    paragraph("Le débiteur reconnaît :");
    bullet("devoir la somme indiquée sans contestation ;");
    bullet("renoncer à toute contestation ultérieure concernant l'origine de la dette.");
    y -= 3;

    heading("Article 5 — Bon pour reconnaissance de dette");
    paragraph("Fait à Gennevilliers,");
    paragraph(`Le : ${fmtDate(signedAt)}`);
    paragraph("Signature du débiteur précédée de la mention manuscrite obligatoire :");
    paragraph(`« ${`Bon pour reconnaissance de dette de ${amountWords}.`} »`, 10, 5);
    await imageBox("Mention manuscrite recueillie :", mentionBytes, 62);
    await imageBox("Signature du débiteur :", signatureBytes, 62);
    line("Signature du créancier :", 10, true, navy);
    line("____________________________________________________________", 9, false, muted);

    heading("Éléments de preuve et empreinte SHA-256");
    paragraph(`Empreinte SHA-256 des données contractuelles et des signatures (hors fichier PDF final) : ${contractDigest}`, 7.5, 3);
    paragraph(`Signature électronique enregistrée le : ${new Date(signedAt).toLocaleString("fr-FR", { timeZone:"UTC" })} UTC`, 8, 2);
    paragraph(`Adresse IP observée : ${ip}`, 8, 2);
    paragraph(`Navigateur : ${userAgent}`, 8, 2);
    paragraph("La présente copie PDF reprend les informations saisies et les traces manuscrites recueillies en ligne. La signature électronique utilisée n'est pas un certificat qualifié d'identité.", 8, 2);

    const bytes = await pdf.save();
    const pdfDigest = await sha256(bytes);
    const path = `${debt.id}/reconnaissance-signee-${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await db.storage.from("signed-debt-documents").upload(path, bytes, { contentType:"application/pdf", upsert:false });
    if (uploadError) throw new Error(`PDF créé mais archivage impossible : ${uploadError.message}`);
    const { data: updatedDebt, error: updateError } = await db.from("debts").update({
      status:"signed", debtor_dob:dob, signed_at:signedAt, signed_pdf_path:path,
      pdf_sha256:pdfDigest, contract_sha256:contractDigest, signature_ip:ip,
      signature_user_agent:userAgent, updated_at:signedAt,
    }).eq("id", debt.id).eq("status","pending_signature").select("id").maybeSingle();
    if (updateError || !updatedDebt) {
      await db.storage.from("signed-debt-documents").remove([path]);
      throw new Error(updateError?.message || "Ce dossier a déjà été signé par une autre session.");
    }
    const warnings: string[] = [];
    const { error: requestUpdateError } = await db.from("signature_requests").update({ signed_at:signedAt }).eq("id",reqRow.id);
    if (requestUpdateError) warnings.push(`Mise à jour du lien de signature : ${requestUpdateError.message}`);
    const { error: eventError } = await db.from("signature_events").insert({
      debt_id:debt.id, event_type:"signed", debtor_dob:dob,
      acceptance_text:`Bon pour reconnaissance de dette de ${amountWords}.`,
      ip_address:ip, user_agent:userAgent, contract_sha256:contractDigest, created_at:signedAt,
    });
    if (eventError) warnings.push(`Journal d'audit : ${eventError.message}`);
    const message = warnings.length
      ? "Votre signature a été enregistrée et le PDF archivé. Une anomalie de journalisation doit être vérifiée par l'administrateur."
      : "Votre signature a été enregistrée. Le document signé est archivé.";
    return json({ ok:true, message, auditWarning:warnings.length ? warnings.join(" ; ") : undefined, contract_sha256:contractDigest, pdf_sha256:pdfDigest });
  } catch (e) { return errorResponse(e); }
});

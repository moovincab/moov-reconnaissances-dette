import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { adminClient, errorResponse, getIp, json, preflight, sha256 } from "../_shared/common.ts";

function dataUrlBytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !value.startsWith("data:image/png;base64,") || value.length > 1500000) throw new Error(`${label} est invalide ou trop volumineux.`);
  const raw = atob(value.slice("data:image/png;base64,".length));
  if (raw.length < 100) throw new Error(`${label} semble vide.`);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
function safePdfText(value: unknown) {
  return String(value ?? "").replace(/[’‘]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,"-").replace(/œ/g,"oe").replace(/Œ/g,"OE").replace(/[\u00a0\u202f]/g," ").replace(/…/g,"...");
}
function fmtMoney(n: number) { return new Intl.NumberFormat("fr-FR", { style:"currency", currency:"EUR" }).format(n); }
function fmtDate(d: string) { return new Date(`${d}T00:00:00Z`).toLocaleDateString("fr-FR", { timeZone:"UTC" }); }
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
    const { data: installments, error: insError } = await db.from("installments").select("sequence_no,due_date,amount").eq("debt_id", debt.id).order("sequence_no");
    if (insError) throw new Error("Impossible de charger l'échéancier.");

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Reconnaissance de dette - ${safePdfText(debt.debtor_name)}`);
    pdf.setAuthor(safePdfText(debt.creditor_name));
    pdf.setSubject("Reconnaissance de dette signée électroniquement");
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const navy = rgb(0.06,0.16,0.26); const blue = rgb(0.09,0.42,0.53); const muted = rgb(0.35,0.42,0.49);
    let page = pdf.addPage([595.28,841.89]); let y = 795;
    const addPage = () => { page = pdf.addPage([595.28,841.89]); y = 795; };
    const text = (s:string, size=10, isBold=false, color=navy, x=48) => { page.drawText(safePdfText(s), { x, y, size, font:isBold?bold:font, color }); y -= size + 7; };
    const paragraph = (s:string, size=10, gap=5) => {
      const maxWidth = 495; const words = safePdfText(s).split(/\s+/); let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate,size) > maxWidth && line) { if (y < 65) addPage(); text(line,size,false,navy); line = word; }
        else line = candidate;
      }
      if (line) text(line,size,false,navy);
      y -= gap;
    };
    text("MOOV IN CAB", 11, true, blue); y -= 5;
    text("RECONNAISSANCE DE DETTE", 19, true, navy); y -= 10;
    text(`Établie le ${new Date().toLocaleDateString("fr-FR")}`, 9, false, muted); y -= 12;
    text("CRÉANCIER", 9, true, blue);
    text(debt.creditor_name, 11, true);
    if (debt.creditor_address) paragraph(debt.creditor_address,10,2);
    y -= 5; text("DÉBITEUR", 9, true, blue);
    text(debt.debtor_name, 11, true);
    if (debt.debtor_address) paragraph(debt.debtor_address,10,2);
    text(`Adresse e-mail : ${debt.debtor_email}`, 9, false, muted); y -= 8;
    text("MONTANT ET OBJET", 9, true, blue);
    text(`${fmtMoney(Number(debt.amount))} (${safePdfText(debt.amount_in_words)} euros)`, 12, true);
    paragraph(`Motif de la dette : ${debt.reason}`,10,5);
    paragraph(`Je soussigné(e) ${debt.debtor_name}, reconnais devoir au créancier désigné ci-dessus la somme de ${fmtMoney(Number(debt.amount))}, selon les modalités d'échéancier ci-dessous.`,10,5);
    text("ÉCHÉANCIER DE REMBOURSEMENT", 9, true, blue); y -= 3;
    for (const inst of (installments || [])) {
      if (y < 75) addPage();
      text(`Échéance ${inst.sequence_no} - ${fmtDate(inst.due_date)} - ${fmtMoney(Number(inst.amount))}`, 9, false, navy);
    }
    if (y < 570) addPage(); else y -= 10;
    text("MENTION MANUSCRITE DU DÉBITEUR", 9, true, blue);
    paragraph(`Mention attendue : « Bon pour reconnaissance de dette de ${debt.amount_in_words} euros (${fmtMoney(Number(debt.amount))}. »`,10,5);
    const mention = await pdf.embedPng(mentionBytes);
    const mentionScale = Math.min(495/mention.width, 95/mention.height);
    page.drawRectangle({x:48,y:y-105,width:499,height:102,borderColor:rgb(.75,.8,.84),borderWidth:.7});
    page.drawImage(mention,{x:51,y:y-102,width:mention.width*mentionScale,height:mention.height*mentionScale}); y -= 125;
    text("SIGNATURE DU DÉBITEUR", 9, true, blue);
    const sig = await pdf.embedPng(signatureBytes);
    const sigScale = Math.min(280/sig.width, 75/sig.height);
    page.drawRectangle({x:48,y:y-84,width:300,height:80,borderColor:rgb(.75,.8,.84),borderWidth:.7});
    page.drawImage(sig,{x:51,y:y-81,width:sig.width*sigScale,height:sig.height*sigScale}); y -= 100;
    text(`Date de naissance déclarée : ${fmtDate(dob)}`, 9, false, muted);
    text(`Signature électronique enregistrée le : ${new Date().toLocaleString("fr-FR", { timeZone:"UTC" })} UTC`, 8, false, muted);
    text(`Adresse IP observée : ${getIp(req) || "non communiquée par le proxy"}`, 8, false, muted);
    text(`Navigateur : ${(req.headers.get("user-agent") || "non communiqué").slice(0,180)}`, 8, false, muted);
    paragraph("La présente copie PDF reprend les informations saisies et les traces manuscrites recueillies en ligne. La signature électronique utilisée n'est pas un certificat qualifié d'identité.",8,2);

    const bytes = await pdf.save();
    const digest = await sha256(bytes);
    const path = `${debt.id}/reconnaissance-signee-${crypto.randomUUID()}.pdf`;
    const { error: uploadError } = await db.storage.from("signed-debt-documents").upload(path, bytes, { contentType:"application/pdf", upsert:false });
    if (uploadError) throw new Error(`PDF créé mais archivage impossible : ${uploadError.message}`);
    const signedAt = new Date().toISOString();
    const { data: updatedDebt, error: updateError } = await db.from("debts").update({ status:"signed", debtor_dob:dob, signed_at:signedAt, signed_pdf_path:path, pdf_sha256:digest, signature_ip:getIp(req), signature_user_agent:(req.headers.get("user-agent") || "").slice(0,500), updated_at:signedAt }).eq("id", debt.id).eq("status","pending_signature").select("id").maybeSingle();
    if (updateError || !updatedDebt) throw new Error(updateError?.message || "Ce dossier a déjà été signé par une autre session.");
    await db.from("signature_requests").update({ signed_at:signedAt }).eq("id",reqRow.id);
    await db.from("signature_events").insert({ debt_id:debt.id, event_type:"signed", debtor_dob:dob, acceptance_text:`Bon pour reconnaissance de dette de ${debt.amount_in_words} euros (${fmtMoney(Number(debt.amount))}).`, ip_address:getIp(req), user_agent:(req.headers.get("user-agent") || "").slice(0,500), created_at:signedAt });
    return json({ ok:true, message:"Votre signature a été enregistrée. Le document signé est archivé." });
  } catch (e) { return errorResponse(e); }
});

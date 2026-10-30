import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.MOOV_CONFIG || {};
const root = document.getElementById("app");
const headerStatus = document.getElementById("header-status");
const missingConfig = !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes("VOTRE-PROJET") || config.SUPABASE_ANON_KEY.includes("VOTRE_CLE");
const supabase = missingConfig ? null : createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let session = null, profile = null, debts = [], profiles = [], creditors = [], selectedDebtId = null, view = "dashboard", notice = null, signatureDocument = null, signatureLoading = false;
const token = new URLSearchParams(location.search).get("signature");

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function money(value) { return new Intl.NumberFormat("fr-FR", {style:"currency",currency:"EUR"}).format(Number(value||0)); }
function date(value) { if (!value) return "—"; return new Date(`${String(value).slice(0,10)}T00:00:00Z`).toLocaleDateString("fr-FR",{timeZone:"UTC"}); }
function dateTime(value) { return value ? new Date(value).toLocaleString("fr-FR") : "—"; }
function frenchInteger(n) {
  const units=["zéro","un","deux","trois","quatre","cinq","six","sept","huit","neuf","dix","onze","douze","treize","quatorze","quinze","seize"];
  if(n<17)return units[n]; if(n<20)return `dix-${units[n-10]}`;
  if(n<70){const tens=Math.floor(n/10)*10,rest=n%10,labels={20:"vingt",30:"trente",40:"quarante",50:"cinquante",60:"soixante"};return !rest?labels[tens]:`${labels[tens]}${rest===1?" et un":`-${units[rest]}`}`;}
  if(n<80){const rest=n-60;return rest===11?"soixante et onze":`soixante-${frenchInteger(rest)}`;}
  if(n<100){const rest=n-80;return !rest?"quatre-vingts":`quatre-vingt${rest===1?"-un":`-${frenchInteger(rest)}`}`;}
  if(n<1000){const h=Math.floor(n/100),rest=n%100,prefix=h===1?"cent":`${units[h]} cent`;return `${prefix}${!rest&&h>1?"s":""}${rest?` ${frenchInteger(rest)}`:""}`;}
  if(n<1000000){const k=Math.floor(n/1000),rest=n%1000;return `${k===1?"mille":`${frenchInteger(k)} mille`}${rest?` ${frenchInteger(rest)}`:""}`;}
  if(n<1000000000){const m=Math.floor(n/1000000),rest=n%1000000;return `${frenchInteger(m)} million${m>1?"s":""}${rest?` ${frenchInteger(rest)}`:""}`;}
  const b=Math.floor(n/1000000000),rest=n%1000000000;return `${frenchInteger(b)} milliard${b>1?"s":""}${rest?` ${frenchInteger(rest)}`:""}`;
}
function amountInFrenchWords(value) {
  const n=Number(value); if(!Number.isFinite(n)||n<0||n>100000000)return "";
  const total=Math.round(n*100),euros=Math.floor(total/100),cents=total%100;
  return `${frenchInteger(euros)} euro${euros>1?"s":""}${cents?` et ${frenchInteger(cents)} centime${cents>1?"s":""}`:""}`;
}
function amountWordsForDebt(d) { return amountInFrenchWords(d?.amount); }
function selectedCreditor() { return creditors.find(c=>c.id===document.getElementById("creditorSelect")?.value) || creditors.find(c=>c.is_default) || creditors[0] || null; }
function updateCreditorDetails(id) {
  const c=creditors.find(x=>x.id===id)||creditors.find(x=>x.is_default)||creditors[0]; if(!c)return;
  for(const [field,value] of [["selectedCreditorName",c.name],["selectedCreditorAddress",c.address],["selectedCreditorSiren",c.siren],["selectedCreditorRepresentative",c.representative]]) {
    const el=document.getElementById(field); if(el)el.value=value||"";
  }
}
function toggleRepaymentFields(mode) {
  const cash=mode==="cash",cashFields=document.getElementById("cashFields"),installmentFields=document.getElementById("installmentFields");
  if(cashFields)cashFields.hidden=!cash; if(installmentFields)installmentFields.hidden=cash;
  const cashDate=document.querySelector('[name="cash_due_date"]'),firstDate=document.querySelector('[name="first_due_date"]'),count=document.querySelector('[name="installment_count"]'),frequency=document.querySelector('[name="frequency"]');
  if(cashDate)cashDate.required=cash; if(firstDate)firstDate.required=!cash; if(count)count.required=!cash; if(frequency)frequency.required=!cash;
}
async function loadCreditors() {
  const {data,error}=await supabase.functions.invoke("manage-creditors",{body:{action:"list"}});
  if(error)throw error;
  creditors=Array.isArray(data?.creditors)?data.creditors:[];
  if(!creditors.length)throw new Error("Aucun créancier disponible. Exécutez la migration des créanciers et déployez la fonction manage-creditors.");
}
function statusLabel(s) { return ({pending_signature:"En attente de signature",signed:"Signée — en remboursement",repaid:"Remboursée"})[s] || s; }
function errorMessage(e) { return e?.message || "Une erreur est survenue. Réessayez."; }
function setNotice(message, type="notice") { notice = {message,type}; }
function noticeHtml() { return notice ? `<div class="${esc(notice.type)}" role="status">${esc(notice.message)}</div>` : ""; }
function pageShell(content) { root.innerHTML = content; }
function loading(message="Chargement…") { pageShell(`<div class="loading">${esc(message)}</div>`); }
function configError() {
  pageShell(`<section class="panel narrow stack"><h1>Configuration nécessaire</h1><p class="muted">Le site est bien préparé pour GitHub Pages, mais il doit être relié à votre projet Supabase.</p><ol><li>Ouvrez <code>config.js</code> dans le dépôt GitHub.</li><li>Remplacez <code>SUPABASE_URL</code> et <code>SUPABASE_ANON_KEY</code> par les valeurs publiques de Supabase.</li><li>Ne collez jamais de clé <code>service_role</code> ou de clé Resend dans ce fichier.</li></ol><p class="help">Les fonctions serveur doivent aussi être déployées dans Supabase et les secrets configurés. Le guide README explique chaque étape.</p></section>`);
}
function renderLogin() {
  headerStatus.textContent = "Espace équipe";
  pageShell(`<section class="panel narrow stack"><div><p class="pill">ESPACE INTERNE</p><h1>Connexion MOOV IN CAB</h1><p class="muted">Gérez les reconnaissances de dette, les signatures et les échéances de remboursement.</p></div>${noticeHtml()}<form id="loginForm" class="stack"><div class="field"><label for="loginEmail">Adresse e-mail</label><input id="loginEmail" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="loginPassword">Mot de passe</label><input id="loginPassword" name="password" type="password" autocomplete="current-password" required></div><button class="btn" type="submit">Se connecter</button></form><p class="help">Les comptes sont créés par un administrateur depuis Supabase. L'inscription publique est désactivée.</p></section>`);
}
function renderDashboard() {
  headerStatus.textContent = `${profile?.full_name || profile?.email || "Équipe"} · ${profile?.role === "admin" ? "Administrateur" : "Collaborateur"}`;
  const all = debts || [];
  const outstanding = all.filter(d => d.status !== "repaid").reduce((s,d)=>s+Number(d.amount||0),0);
  const pending = all.filter(d => d.status === "pending_signature").length;
  const late = all.reduce((sum,d)=>sum+(d.installments||[]).filter(i=>i.status==="pending" && i.due_date < new Date().toISOString().slice(0,10)).length,0);
  const term = (document.getElementById("searchDebts")?.value || "").toLowerCase();
  const filtered = all.filter(d => `${d.debtor_name} ${d.debtor_email} ${d.reason}`.toLowerCase().includes(term));
  pageShell(`<div class="hero"><div><h1>Tableau de bord</h1><p class="muted">Suivi des dossiers, signatures et échéances de remboursement.</p></div><div class="actions"><button class="btn secondary" data-action="refresh">Actualiser</button><button class="btn" data-action="new">+ Nouvelle reconnaissance</button><button class="btn secondary" data-action="logout">Déconnexion</button></div></div>${noticeHtml()}<div class="stats"><div class="stat"><strong>${all.length}</strong><span>Dossiers au total</span></div><div class="stat"><strong>${pending}</strong><span>En attente de signature</span></div><div class="stat"><strong>${money(outstanding)}</strong><span>Montant des dossiers non soldés</span></div></div><div class="panel"><div class="toolbar"><h2>Dossiers</h2><input id="searchDebts" type="search" placeholder="Rechercher un débiteur…" value="${esc(term)}"></div><div id="debtList" class="debt-list">${filtered.length ? filtered.map(d=>`<article class="debt-row"><div><h3>${esc(d.debtor_name)}</h3><p class="muted small">${esc(d.debtor_email)} · Créé le ${date(d.created_at)}</p><p class="small">${esc(d.reason)}</p><span class="badge ${esc(d.status)}">${esc(statusLabel(d.status))}</span>${(d.installments||[]).some(i=>i.status==="pending" && i.due_date < new Date().toISOString().slice(0,10))?` <span class="badge" style="background:#fff0ef;color:#b42318">Échéance(s) en retard</span>`:""}</div><div class="stack" style="justify-items:end"><div class="amount">${money(d.amount)}</div><button class="btn secondary small-btn" data-action="detail" data-id="${esc(d.id)}">Ouvrir le dossier</button></div></article>`).join(""):`<div class="empty">${all.length ? "Aucun dossier ne correspond à la recherche." : "Aucun dossier pour le moment. Cliquez sur « Nouvelle reconnaissance » pour commencer."}</div>`}</div></div>${profile?.role === "admin" ? `<div class="section-title"><h2>Équipe</h2><button class="btn secondary" data-action="invite">Inviter un collaborateur</button></div><div class="panel"><p class="muted">Les rappels d'échéance sont envoyés par e-mail au responsable affecté à chaque dossier.</p><div class="inline">${profiles.map(p=>`<span class="pill">${esc(p.full_name||p.email)} · ${esc(p.email)}</span>`).join("")}</div></div>`:""}`);
  root.querySelector("#searchDebts")?.addEventListener("input", (e) => { const el=e.target; const pos=el.selectionStart; renderDashboard(); const next=root.querySelector("#searchDebts"); if(next){next.focus();next.setSelectionRange(pos,pos);} });
}
function renderCreate() {
  const defaultCreditor=creditors.find(c=>c.is_default)||creditors[0]||{};
  const todayPlus7=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  pageShell(`<div class="hero"><div><h1>Nouvelle reconnaissance de dette</h1><p class="muted">Renseignez les informations du contrat. Le débiteur recevra un lien de signature par e-mail.</p></div><button class="btn secondary" data-action="back">Retour au tableau de bord</button></div>${noticeHtml()}<form id="createForm" class="panel stack"><h2>Créancier et débiteur</h2><div class="grid"><div class="field"><label for="creditorSelect">Créancier</label><select id="creditorSelect" name="creditor_id" required>${creditors.map(c=>`<option value="${esc(c.id)}" ${c.id===defaultCreditor.id?"selected":""}>${esc(c.name)}${c.siren?` — SIREN ${esc(c.siren)}`:""}</option>`).join("")}</select><button class="btn secondary small-btn" type="button" data-action="add-creditor">+ Ajouter un créancier</button></div><div class="field"><label>Nom du créancier sélectionné</label><input id="selectedCreditorName" value="${esc(defaultCreditor.name||"")}" readonly></div><div class="field"><label>Adresse du créancier</label><input id="selectedCreditorAddress" value="${esc(defaultCreditor.address||"")}" readonly></div><div class="field"><label>SIREN</label><input id="selectedCreditorSiren" value="${esc(defaultCreditor.siren||"")}" readonly></div><div class="field" style="grid-column:1/-1"><label>Représentant légal</label><input id="selectedCreditorRepresentative" value="${esc(defaultCreditor.representative||"")}" readonly></div><div class="field"><label>Nom et prénom du débiteur</label><input name="debtor_name" required maxlength="180"></div><div class="field"><label>Date de naissance</label><p class="help">Le débiteur la renseignera au moment de la signature électronique.</p></div><div class="field"><label>E-mail du débiteur</label><input name="debtor_email" type="email" required></div><div class="field"><label>Téléphone du débiteur</label><input name="debtor_phone" type="tel" required maxlength="80"></div><div class="field" style="grid-column:1/-1"><label>Adresse du débiteur</label><input name="debtor_address" required maxlength="1000" placeholder="Adresse postale complète"></div></div><div class="separator"></div><h2>Contrat de location et dette</h2><div class="grid"><div class="field"><label>Véhicule</label><input name="vehicle" required maxlength="180" placeholder="Marque et modèle"></div><div class="field"><label>Immatriculation</label><input name="vehicle_registration" required maxlength="30" placeholder="Ex. AB-123-CD"></div><div class="field"><label>Contrat de location signé le</label><input name="rental_contract_signed_at" type="date" required></div><div class="field"><label>Montant total de la dette (€)</label><input id="debtAmount" name="amount" type="number" min="0.01" max="100000000" step="0.01" required></div><div class="field" style="grid-column:1/-1"><label>Montant en toutes lettres</label><input id="amountInWords" name="amount_in_words" placeholder="Calculé automatiquement" readonly required><span class="help">Le montant en toutes lettres est calculé automatiquement à partir du montant en euros et centimes.</span></div><div class="field" style="grid-column:1/-1"><label>Précision complémentaire sur les loyers impayés (facultatif)</label><textarea name="reason" maxlength="3000" placeholder="Facultatif"></textarea></div></div><div class="separator"></div><h2>Modalités de remboursement</h2><div class="field"><label>Mode de remboursement</label><select id="repaymentMode" name="repayment_mode" required><option value="installments" selected>Paiement échelonné</option><option value="cash">Paiement comptant</option></select></div><div id="cashFields" class="grid" hidden><div class="field"><label>Paiement comptant au plus tard le</label><input name="cash_due_date" type="date" value="${todayPlus7}"></div></div><div id="installmentFields" class="grid"><div class="field"><label>Nombre d'échéances (1 à 60)</label><input name="installment_count" type="number" min="1" max="60" value="4" required></div><div class="field"><label>Fréquence</label><select name="frequency" required><option value="weekly">Hebdomadaire</option><option value="monthly" selected>Mensuelle</option></select></div><div class="field"><label>Date de la première échéance</label><input name="first_due_date" type="date" required value="${todayPlus7}"></div></div><div class="field"><label>Responsable des rappels</label><select name="assigned_to" required>${profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===profile?.id?"selected":""}>${esc(p.full_name||p.email)} — ${esc(p.email)}</option>`).join("")}</select></div><div class="notice">Le débiteur verra le document complet avant de signer. La signature manuscrite et les preuves techniques du parcours existant seront conservées dans le PDF signé.</div><div class="actions"><button class="btn" type="submit">Créer le dossier et envoyer le lien</button><button class="btn secondary" type="button" data-action="back">Annuler</button></div></form><div id="creditorModal" class="modal" hidden><div class="modal-panel"><div class="hero"><div><h2>Ajouter un créancier</h2><p class="muted">Le nouveau créancier sera enregistré et disponible pour les prochains dossiers.</p></div><button class="btn secondary small-btn" type="button" data-action="close-creditor">Fermer</button></div><form id="creditorForm" class="stack"><div class="field"><label>Nom de la société / du créancier</label><input name="name" required maxlength="180"></div><div class="field"><label>Adresse</label><input name="address" required maxlength="500"></div><div class="field"><label>SIREN (9 chiffres, si applicable)</label><input name="siren" inputmode="numeric" pattern="[0-9]{9}" maxlength="9"></div><div class="field"><label>Représentant légal</label><input name="representative" required maxlength="250"></div><div class="actions"><button class="btn" type="submit">Enregistrer et sélectionner</button><button class="btn secondary" type="button" data-action="close-creditor">Annuler</button></div></form></div></div>`);
  toggleRepaymentFields("installments");
} 
function renderInvite() {
  pageShell(`<div class="hero"><div><h1>Inviter un collaborateur</h1><p class="muted">Un lien d'invitation sera envoyé par le système d'authentification Supabase.</p></div><button class="btn secondary" data-action="back">Retour</button></div>${noticeHtml()}<form id="inviteForm" class="panel narrow stack"><div class="field"><label>Nom complet</label><input name="full_name" required maxlength="180"></div><div class="field"><label>Adresse e-mail</label><input name="email" type="email" required></div><button class="btn" type="submit">Envoyer l'invitation</button><p class="help">L'envoi des invitations dépend aussi de la configuration e-mail d'authentification dans Supabase.</p></form>`);
}
function renderDetail(debt) {
  if (!debt) { setNotice("Dossier introuvable.","error"); view="dashboard"; renderDashboard(); return; }
  const inst=[...(debt.installments||[])].sort((a,b)=>a.sequence_no-b.sequence_no);
  const assigned=profiles.find(p=>p.id===debt.assigned_to);
  pageShell(`<div class="hero"><div><h1>${esc(debt.debtor_name)}</h1><p class="muted">Dossier créé le ${date(debt.created_at)} · ${esc(debt.debtor_email)}</p><span class="badge ${esc(debt.status)}">${esc(statusLabel(debt.status))}</span></div><div class="actions"><button class="btn secondary" data-action="back">Retour</button>${debt.status==="pending_signature"?`<button class="btn" data-action="resend" data-id="${esc(debt.id)}">Renvoyer le lien de signature</button>`:""}${debt.signed_pdf_path?`<button class="btn" data-action="download" data-id="${esc(debt.id)}">Télécharger le PDF signé</button>`:""}</div></div>${noticeHtml()}<section class="panel stack"><h2>Détails de la reconnaissance de dette</h2><div class="detail-grid"><div class="detail-item"><span>Créancier</span><strong>${esc(debt.creditor_name)}</strong></div><div class="detail-item"><span>Adresse du créancier</span><strong>${esc(debt.creditor_address||"—")}</strong></div><div class="detail-item"><span>SIREN</span><strong>${esc(debt.creditor_siren||"—")}</strong></div><div class="detail-item"><span>Représentant légal</span><strong>${esc(debt.creditor_representative||"—")}</strong></div><div class="detail-item"><span>Débiteur</span><strong>${esc(debt.debtor_name)}</strong></div><div class="detail-item"><span>Téléphone</span><strong>${esc(debt.debtor_phone||"—")}</strong></div><div class="detail-item"><span>Adresse du débiteur</span><strong>${esc(debt.debtor_address||"—")}</strong></div><div class="detail-item"><span>Véhicule</span><strong>${esc(debt.vehicle||"—")}</strong></div><div class="detail-item"><span>Immatriculation</span><strong>${esc(debt.vehicle_registration||"—")}</strong></div><div class="detail-item"><span>Contrat signé le</span><strong>${date(debt.rental_contract_signed_at)}</strong></div><div class="detail-item"><span>Montant</span><strong>${money(debt.amount)}</strong></div><div class="detail-item"><span>Montant en toutes lettres</span><strong>${esc(amountWordsForDebt(debt))}</strong></div><div class="detail-item"><span>Remboursement</span><strong>${debt.repayment_mode==="cash"?`Comptant au plus tard le ${date(debt.cash_due_date)}`:"Échelonné"}</strong></div><div class="detail-item"><span>Responsable</span><strong>${esc(assigned?.full_name||assigned?.email||"Non défini")}</strong></div>${debt.signed_at?`<div class="detail-item"><span>Signé le</span><strong>${dateTime(debt.signed_at)}</strong></div><div class="detail-item"><span>Empreinte SHA-256 du PDF final</span><strong style="font-size:11px;word-break:break-all">${esc(debt.pdf_sha256||"—")}</strong></div><div class="detail-item"><span>Empreinte SHA-256 des données et signatures</span><strong style="font-size:11px;word-break:break-all">${esc(debt.contract_sha256||"—")}</strong></div>`:""}</div></section><div class="section-title"><h2>Échéancier de remboursement</h2><span class="pill">${inst.filter(i=>i.status==="paid").length}/${inst.length} payées</span></div><div class="panel table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Montant</th><th>État</th><th>Action</th></tr></thead><tbody>${inst.map(i=>`<tr><td>${i.sequence_no}</td><td>${date(i.due_date)}</td><td>${money(i.amount)}</td><td><span class="badge ${i.status==="paid"?"repaid":"pending_signature"}">${i.status==="paid"?"Payée":"À payer"}</span></td><td>${debt.status!=="pending_signature"?`<button class="btn ${i.status==="paid"?"secondary":""} small-btn" data-action="mark" data-id="${esc(i.id)}" data-paid="${i.status!=="paid"}">${i.status==="paid"?"Annuler paiement":"Marquer payée"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div><p class="help">Le statut « payée » est saisi manuellement par un collaborateur. L'application ne vérifie pas les paiements bancaires.</p>`);
}
function canvasInit(id) {
  const canvas = document.getElementById(id); if (!canvas) return;
  const ctx = canvas.getContext("2d"); const ratio = Math.max(1,window.devicePixelRatio||1); const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width*ratio); canvas.height = Math.floor(rect.height*ratio); ctx.scale(ratio,ratio); ctx.lineWidth=2.2; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.strokeStyle="#102a43";
  let drawing=false, drawn=false;
  function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
  canvas.addEventListener("pointerdown",e=>{drawing=true;canvas.setPointerCapture(e.pointerId);const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+.1,p.y+.1);ctx.stroke();drawn=true;e.preventDefault();});
  canvas.addEventListener("pointermove",e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();e.preventDefault();});
  const stop=()=>{drawing=false;}; canvas.addEventListener("pointerup",stop);canvas.addEventListener("pointercancel",stop);canvas.addEventListener("pointerleave",stop);
  canvas._clear=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);drawn=false;};
  canvas._isDrawn=()=>drawn;
}
async function renderSignature() {
  headerStatus.textContent="Signature sécurisée";
  if (missingConfig) { configError(); return; }
  if (!signatureDocument && !signatureLoading) {
    signatureLoading=true; loading("Vérification du lien de signature…");
    try { const {data,error}=await supabase.functions.invoke("get-signature-document",{body:{token}}); if(error)throw error; signatureDocument=data; }
    catch(e){signatureDocument={error:errorMessage(e)};} finally{signatureLoading=false;}
  }
  if(signatureDocument?.error){pageShell(`<section class="panel narrow stack"><h1>Lien indisponible</h1><div class="error">${esc(signatureDocument.error)}</div><p class="muted">Contactez MOOV IN CAB pour demander un nouveau lien.</p></section>`);return;}
  if(signatureDocument?.signed){pageShell(`<section class="panel narrow stack"><h1>Document déjà signé</h1><div class="success">${esc(signatureDocument.message||"Votre signature a déjà été enregistrée.")}</div><p class="muted">Vous pouvez fermer cette page.</p></section>`);return;}
  if(!signatureDocument?.debt){pageShell(`<div class="loading">Chargement du document…</div>`);return;}
  const d=signatureDocument.debt, installments=signatureDocument.installments||[];
  const words=amountWordsForDebt(d), phrase=`Bon pour reconnaissance de dette de ${words}.`;
  const cash=d.repayment_mode==="cash";
  const paymentHtml=cash?`<p>[X] Paiement comptant au plus tard le : <strong>${date(d.cash_due_date)}</strong></p><p>[ ] Paiement échelonné</p>`:`<p>[ ] Paiement comptant au plus tard le : ___ / ___ / _____</p><p>[X] Paiement échelonné : en ${installments.length} fois</p><ul>${installments.map(i=>`<li>${money(i.amount)} le ${date(i.due_date)}</li>`).join("")}</ul><p>par virement bancaire sur le compte du créancier ;</p>`;
  pageShell(`<section class="signature-paper stack"><div><p class="pill">MOOV IN CAB · DOCUMENT À SIGNER</p><h1>RECONNAISSANCE DE DETTE</h1><p>Entre les soussignés :</p><h3>Le créancier :</h3><p>Société : <strong>${esc(d.creditor_name)}</strong><br>Adresse : ${esc(d.creditor_address||"—")}<br>SIREN : ${esc(d.creditor_siren||"—")}<br>Représentée par : ${esc(d.creditor_representative||"—")}</p><p><em>Et</em></p><h3>Le débiteur :</h3><p>Nom et prénom : ${esc(d.debtor_name)}<br>Date de naissance : renseignée au moment de la signature<br>Adresse : ${esc(d.debtor_address||"—")}<br>Téléphone : ${esc(d.debtor_phone||"—")}</p></div>${noticeHtml()}<div><h3>Article 1 — Objet</h3><p>Je soussigné(e) ${esc(d.debtor_name)}, reconnais devoir à la société « ${esc(d.creditor_name)} » la somme de :</p><p><strong>${money(d.amount)} (${esc(words)})</strong></p><p>au titre de loyers impayés, liés au contrat de location du véhicule :</p><p>Véhicule : ${esc(d.vehicle||"—")}<br>Immatriculation : ${esc(d.vehicle_registration||"—")}<br>Contrat de location signé le : ${date(d.rental_contract_signed_at)}</p></div><div><h3>Article 2 — Modalités de remboursement</h3><p>Le débiteur s’engage à rembourser la dette selon les modalités suivantes :</p>${paymentHtml}</div><div><h3>Article 3 — Défaut de paiement</h3><p>En cas de non-respect d’une échéance :</p><ul><li>la totalité de la somme restante deviendra immédiatement exigible ;</li><li>le créancier pourra engager toute procédure de recouvrement judiciaire.</li></ul><p>Les frais de recouvrement seront à la charge du débiteur.</p></div><div><h3>Article 4 — Reconnaissance expresse</h3><p>Le débiteur reconnaît :</p><ul><li>devoir la somme indiquée sans contestation ;</li><li>renoncer à toute contestation ultérieure concernant l’origine de la dette.</li></ul></div><div><h3>Article 5 — Bon pour reconnaissance de dette</h3><p>Fait à Gennevilliers, le jour de la signature électronique.</p><p>Signature du débiteur précédée de la mention manuscrite obligatoire :</p><div class="phrase">${esc(phrase)}</div></div><form id="signatureForm" class="stack"><div class="field"><label for="debtorDob">Date de naissance du débiteur</label><input id="debtorDob" name="debtor_dob" type="date" required max="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Recopiez la mention manuscrite</label><div class="canvas-wrap"><canvas id="mentionCanvas" class="signature-canvas mention" aria-label="Zone pour écrire la mention manuscrite"></canvas><div class="canvas-tools"><span>Écrivez la mention complète ci-dessus.</span><button type="button" class="btn secondary small-btn" data-action="clear-canvas" data-id="mentionCanvas">Effacer</button></div></div></div><div class="field"><label>Signature du débiteur</label><div class="canvas-wrap"><canvas id="signatureCanvas" class="signature-canvas" aria-label="Zone pour dessiner la signature"></canvas><div class="canvas-tools"><span>Signez avec votre doigt ou votre souris.</span><button type="button" class="btn secondary small-btn" data-action="clear-canvas" data-id="signatureCanvas">Effacer</button></div></div></div><label class="checkbox"><input type="checkbox" name="accepted" required><span>Je confirme avoir lu le document complet, reconnaître les informations présentées et accepter la dette et ses modalités de remboursement. Je comprends que ma signature électronique sera enregistrée avec la date et des données techniques de connexion.</span></label><button class="btn" type="submit">Confirmer et signer</button><p class="help">La date de naissance est déclarative. Cette signature n'est pas une signature électronique qualifiée avec vérification officielle de l'identité.</p></form></section>`);
  canvasInit("mentionCanvas"); canvasInit("signatureCanvas");
}
async function loadDashboard() {
  const [dResult,pResult] = await Promise.all([
    supabase.from("debts").select("*, installments(*)").order("created_at",{ascending:false}),
    supabase.from("profiles").select("id,email,full_name,role").order("full_name")
  ]);
  if (dResult.error) throw dResult.error; if (pResult.error) throw pResult.error;
  debts=dResult.data||[]; profiles=pResult.data||[];
}
async function boot() {
  if (token) { await renderSignature(); return; }
  if (missingConfig) { configError(); return; }
  const {data}=await supabase.auth.getSession(); session=data.session;
  if (session) {
    const {data:p,error}=await supabase.from("profiles").select("id,email,full_name,role").eq("id",session.user.id).single();
    if(error||!p){setNotice("Profil introuvable. Vérifiez que la migration SQL a été exécutée.","error");profile=null;renderLogin();return;}
    profile=p;
    try { await loadDashboard(); view="dashboard"; renderDashboard(); }
    catch(e){setNotice(errorMessage(e),"error");renderDashboard();}
  } else { renderLogin(); }
}
root.addEventListener("change", (event) => {
  const target=event.target;
  if(target?.id==="creditorSelect") updateCreditorDetails(target.value);
  if(target?.id==="repaymentMode") toggleRepaymentFields(target.value);
});
root.addEventListener("input", (event) => {
  if(event.target?.id==="debtAmount") { const words=document.getElementById("amountInWords"); if(words)words.value=amountInFrenchWords(event.target.value); }
});

root.addEventListener("submit", async (event) => {
  event.preventDefault(); const form=event.target; const submit=form.querySelector('[type="submit"]'); if(submit)submit.disabled=true;
  try {
    if(form.id==="loginForm") {
      const fd=new FormData(form); const {error}=await supabase.auth.signInWithPassword({email:fd.get("email"),password:fd.get("password")}); if(error)throw error; notice=null; await boot();
    } else if(form.id==="creditorForm") {
      const fd=new FormData(form); const payload=Object.fromEntries(fd.entries()); payload.action="create";
      const {data,error}=await supabase.functions.invoke("manage-creditors",{body:payload}); if(error)throw error;
      const c=data?.creditor; if(!c?.id)throw new Error("Le créancier n'a pas été renvoyé par le serveur.");
      if(!creditors.some(x=>x.id===c.id))creditors.push(c);
      const select=document.getElementById("creditorSelect");
      if(select){select.innerHTML=creditors.slice().sort((a,b)=>Number(Boolean(b.is_default))-Number(Boolean(a.is_default))||String(a.name).localeCompare(String(b.name),"fr")).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}${x.siren?` — SIREN ${esc(x.siren)}`:""}</option>`).join("");select.value=c.id;}
      updateCreditorDetails(c.id); const modal=document.getElementById("creditorModal"); if(modal)modal.hidden=true;
      const info=document.createElement("div"); info.className="success"; info.setAttribute("role","status"); info.textContent=data?.existing?"Ce créancier existait déjà ; il a été sélectionné.":"Créancier enregistré et sélectionné.";
      document.getElementById("createForm")?.prepend(info); form.reset();
    } else if(form.id==="createForm") {
      const fd=new FormData(form); const body=Object.fromEntries(fd.entries()); body.amount=Number(body.amount); if(body.installment_count)body.installment_count=Number(body.installment_count);
      const {data,error}=await supabase.functions.invoke("create-debt",{body});if(error)throw error;
      if(data?.emailSent===false){setNotice(`Dossier créé, mais l'e-mail n'a pas pu être envoyé : ${data.emailWarning||"vérifiez Resend et les secrets Supabase"}.`,"error");}else{setNotice("Dossier créé. Le lien de signature a été envoyé au débiteur.","success");}
      await loadDashboard();view="dashboard";renderDashboard();
    } else if(form.id==="inviteForm") {
      const fd=new FormData(form);const {data,error}=await supabase.functions.invoke("invite-user",{body:Object.fromEntries(fd.entries())});if(error)throw error;setNotice(data?.message||"Invitation envoyée.","success");await loadDashboard();view="dashboard";renderDashboard();
    } else if(form.id==="signatureForm") {
      const mention=document.getElementById("mentionCanvas"),sig=document.getElementById("signatureCanvas");
      if(!mention?._isDrawn?.() || !sig?._isDrawn?.())throw new Error("Veuillez écrire la mention manuscrite et signer dans les deux zones.");
      const fd=new FormData(form);const payload={token,debtor_dob:fd.get("debtor_dob"),accepted:fd.get("accepted")==="on",mention_png:mention.toDataURL("image/png"),signature_png:sig.toDataURL("image/png")};
      const {data,error}=await supabase.functions.invoke("sign-debt",{body:payload});if(error)throw error;signatureDocument={signed:true,message:data?.message||"Votre signature a été enregistrée."};setNotice(null);await renderSignature();
    }
  } catch(e) { setNotice(errorMessage(e),"error"); if(form.id==="signatureForm"){await renderSignature();}else if(form.id==="loginForm"){renderLogin();}else if(form.id==="createForm"){renderCreate();}else if(form.id==="inviteForm"){renderInvite();}else if(form.id==="creditorForm"){const modal=document.getElementById("creditorModal");if(modal)modal.hidden=false;const info=document.createElement("div");info.className="error";info.textContent=errorMessage(e);form.prepend(info);} }
  finally { if(submit)submit.disabled=false; }
});
root.addEventListener("click", async (event) => {
  const button=event.target.closest("[data-action]");if(!button)return;
  const action=button.dataset.action;const id=button.dataset.id;
  try {
    if(action==="new"){notice=null;view="create";await loadCreditors();renderCreate();}
    else if(action==="add-creditor"){const modal=document.getElementById("creditorModal");if(modal)modal.hidden=false;}
    else if(action==="close-creditor"){const modal=document.getElementById("creditorModal");if(modal)modal.hidden=true;}
    else if(action==="invite"){notice=null;view="invite";renderInvite();}
    else if(action==="back"||action==="refresh"){notice=null;await loadDashboard();view="dashboard";renderDashboard();}
    else if(action==="logout"){await supabase.auth.signOut();session=null;profile=null;debts=[];notice=null;renderLogin();}
    else if(action==="detail"){selectedDebtId=id;view="detail";notice=null;renderDetail(debts.find(d=>d.id===id));}
    else if(action==="resend"){button.disabled=true;const {data,error}=await supabase.functions.invoke("resend-signature-link",{body:{debt_id:id}});if(error)throw error;setNotice(data?.message||"Nouveau lien envoyé.","success");await loadDashboard();view="detail";renderDetail(debts.find(d=>d.id===selectedDebtId));}
    else if(action==="download"){const downloadWindow=window.open("about:blank","_blank");button.disabled=true;const {data,error}=await supabase.functions.invoke("download-signed-pdf",{body:{debt_id:id}});if(error){downloadWindow?.close();throw error;}if(!data?.url){downloadWindow?.close();throw new Error("Lien de téléchargement manquant.");}if(downloadWindow)downloadWindow.location.href=data.url;else location.href=data.url;button.disabled=false;}
    else if(action==="mark"){button.disabled=true;const {error}=await supabase.functions.invoke("mark-installment",{body:{installment_id:id,paid:button.dataset.paid==="true"}});if(error)throw error;await loadDashboard();view="detail";renderDetail(debts.find(d=>d.id===selectedDebtId));}
    else if(action==="clear-canvas"){document.getElementById(id)?._clear?.();}
  } catch(e){setNotice(errorMessage(e),"error");if(view==="detail")renderDetail(debts.find(d=>d.id===selectedDebtId));else if(view==="create"){renderDashboard();}else renderDashboard();}
});
supabase?.auth.onAuthStateChange((_event,newSession)=>{session=newSession; if(!token) setTimeout(()=>boot().catch(e=>{setNotice(errorMessage(e),"error");renderLogin();}),0);});
boot().catch(e=>{setNotice(errorMessage(e),"error");renderLogin();});

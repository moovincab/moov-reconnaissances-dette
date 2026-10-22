import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const config = window.MOOV_CONFIG || {};
const root = document.getElementById("app");
const headerStatus = document.getElementById("header-status");
const missingConfig = !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY || config.SUPABASE_URL.includes("VOTRE-PROJET") || config.SUPABASE_ANON_KEY.includes("VOTRE_CLE");
const supabase = missingConfig ? null : createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
let session = null, profile = null, debts = [], profiles = [], selectedDebtId = null, view = "dashboard", notice = null, signatureDocument = null, signatureLoading = false;
const token = new URLSearchParams(location.search).get("signature");

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function money(value) { return new Intl.NumberFormat("fr-FR", {style:"currency",currency:"EUR"}).format(Number(value||0)); }
function date(value) { if (!value) return "—"; return new Date(`${String(value).slice(0,10)}T00:00:00Z`).toLocaleDateString("fr-FR",{timeZone:"UTC"}); }
function dateTime(value) { return value ? new Date(value).toLocaleString("fr-FR") : "—"; }
function statusLabel(s) { return ({pending_signature:"En attente de signature",signed:"Signée — en remboursement",repaid:"Remboursée"})[s] || s; }
function errorMessage(e) { return e?.message || "Une erreur est survenue. Réessayez."; }
async function detailedErrorMessage(e) {
  const response = e?.context;
  if (response && typeof response.clone === "function") {
    const payload = await response.clone().json().catch(() => null);
    if (typeof payload?.error === "string") return payload.error;
    if (typeof payload?.message === "string") return payload.message;
  }
  return errorMessage(e);
}
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
  pageShell(`<div class="hero"><div><h1>Nouvelle reconnaissance de dette</h1><p class="muted">Renseignez les informations et l'échéancier. Le débiteur recevra un lien de signature par e-mail.</p></div><button class="btn secondary" data-action="back">Retour au tableau de bord</button></div>${noticeHtml()}<form id="createForm" class="panel stack"><h2>Créancier et débiteur</h2><div class="grid"><div class="field"><label>Nom du créancier</label><input name="creditor_name" value="MOOV IN CAB" required></div><div class="field"><label>Adresse du créancier</label><input name="creditor_address" placeholder="Adresse de MOOV IN CAB"></div><div class="field"><label>Nom complet du débiteur</label><input name="debtor_name" required maxlength="180"></div><div class="field"><label>E-mail du débiteur</label><input name="debtor_email" type="email" required></div><div class="field" style="grid-column:1/-1"><label>Adresse du débiteur</label><input name="debtor_address" placeholder="Adresse postale"></div></div><div class="separator"></div><h2>Dette et remboursement</h2><div class="grid"><div class="field"><label>Montant total (€)</label><input name="amount" type="number" min="0.01" max="100000000" step="0.01" required></div><div class="field"><label>Montant en toutes lettres</label><input name="amount_in_words" placeholder="ex. mille deux cents" required maxlength="250"><span class="help">Saisissez le montant sans le mot « euros » : la mention manuscrite demandée sera construite à partir de cette valeur.</span></div><div class="field"><label>Motif de la dette</label><textarea name="reason" required maxlength="3000" placeholder="Décrire l'origine de la dette"></textarea></div><div class="field"><label>Responsable des rappels</label><select name="assigned_to" required>${profiles.map(p=>`<option value="${esc(p.id)}" ${p.id===profile?.id?"selected":""}>${esc(p.full_name||p.email)} — ${esc(p.email)}</option>`).join("")}</select></div><div class="field"><label>Nombre d'échéances (1 à 60)</label><input name="installment_count" type="number" min="1" max="60" value="4" required></div><div class="field"><label>Fréquence</label><select name="frequency"><option value="weekly">Hebdomadaire</option><option value="monthly" selected>Mensuelle</option></select></div><div class="field"><label>Date de la première échéance</label><input name="first_due_date" type="date" required value="${new Date(Date.now()+7*86400000).toISOString().slice(0,10)}"></div></div><div class="notice">Un lien de signature valable 14 jours sera envoyé par e-mail. Le montant des échéances sera calculé automatiquement, avec ajustement des centimes sur les premières échéances.</div><div class="actions"><button class="btn" type="submit">Créer le dossier et envoyer le lien</button><button class="btn secondary" type="button" data-action="back">Annuler</button></div></form>`);
}
function renderInvite() {
  pageShell(`<div class="hero"><div><h1>Inviter un collaborateur</h1><p class="muted">Un lien d'invitation sera envoyé par le système d'authentification Supabase.</p></div><button class="btn secondary" data-action="back">Retour</button></div>${noticeHtml()}<form id="inviteForm" class="panel narrow stack"><div class="field"><label>Nom complet</label><input name="full_name" required maxlength="180"></div><div class="field"><label>Adresse e-mail</label><input name="email" type="email" required></div><button class="btn" type="submit">Envoyer l'invitation</button><p class="help">L'envoi des invitations dépend aussi de la configuration e-mail d'authentification dans Supabase.</p></form>`);
}
function renderDetail(debt) {
  if (!debt) { setNotice("Dossier introuvable.","error"); view="dashboard"; renderDashboard(); return; }
  const inst = [...(debt.installments||[])].sort((a,b)=>a.sequence_no-b.sequence_no);
  pageShell(`<div class="hero"><div><h1>${esc(debt.debtor_name)}</h1><p class="muted">Dossier créé le ${date(debt.created_at)} · ${esc(debt.debtor_email)}</p><span class="badge ${esc(debt.status)}">${esc(statusLabel(debt.status))}</span></div><div class="actions"><button class="btn secondary" data-action="back">Retour</button>${debt.status === "pending_signature" ? `<button class="btn" data-action="resend" data-id="${esc(debt.id)}">Renvoyer le lien de signature</button>` : ""}${debt.signed_pdf_path?`<button class="btn" data-action="download" data-id="${esc(debt.id)}">Télécharger le PDF signé</button>`:""}</div></div>${noticeHtml()}<section class="panel"><h2>Détails de la dette</h2><div class="detail-grid"><div class="detail-item"><span>Créancier</span><strong>${esc(debt.creditor_name)}</strong></div><div class="detail-item"><span>Montant</span><strong>${money(debt.amount)}</strong></div><div class="detail-item"><span>Montant en toutes lettres</span><strong>${esc(debt.amount_in_words)} euros</strong></div><div class="detail-item"><span>Responsable</span><strong>${esc(profiles.find(p=>p.id===debt.assigned_to)?.full_name || profiles.find(p=>p.id===debt.assigned_to)?.email || "Non défini")}</strong></div><div class="detail-item"><span>Adresse du débiteur</span><strong>${esc(debt.debtor_address||"—")}</strong></div><div class="detail-item"><span>Motif</span><strong>${esc(debt.reason)}</strong></div>${debt.signed_at?`<div class="detail-item"><span>Signé le</span><strong>${dateTime(debt.signed_at)}</strong></div><div class="detail-item"><span>Empreinte SHA-256 du PDF</span><strong style="font-size:11px">${esc(debt.pdf_sha256||"—")}</strong></div>`:""}</div></section><div class="section-title"><h2>Échéancier de remboursement</h2><span class="pill">${inst.filter(i=>i.status==="paid").length}/${inst.length} payées</span></div><div class="panel table-wrap"><table><thead><tr><th>N°</th><th>Date</th><th>Montant</th><th>État</th><th>Action</th></tr></thead><tbody>${inst.map(i=>`<tr><td>${i.sequence_no}</td><td>${date(i.due_date)}</td><td>${money(i.amount)}</td><td><span class="badge ${i.status==="paid"?"repaid":"pending_signature"}">${i.status==="paid"?"Payée":"À payer"}</span></td><td>${debt.status!=="pending_signature"?`<button class="btn ${i.status==="paid"?"secondary":""} small-btn" data-action="mark" data-id="${esc(i.id)}" data-paid="${i.status!=="paid"}">${i.status==="paid"?"Annuler paiement":"Marquer payée"}</button>`:"—"}</td></tr>`).join("")}</tbody></table></div><p class="help">Le statut « payée » est saisi manuellement par un collaborateur. L'application ne vérifie pas les paiements bancaires.</p>`);
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
function textToPng(text) {
  const canvas = document.createElement("canvas");
  const width = 1600, padding = 32, fontSize = 32, lineHeight = 44;
  canvas.width = width;
  canvas.height = 200;
  let ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px Arial, sans-serif`;
  const maxWidth = width - padding * 2;
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  canvas.height = padding * 2 + Math.max(1, lines.length) * lineHeight;
  ctx = canvas.getContext("2d");
  ctx.font = `${fontSize}px Arial, sans-serif`;
  ctx.fillStyle = "#102a43";
  ctx.textBaseline = "top";
  lines.forEach((value, index) => ctx.fillText(value, padding, padding + index * lineHeight));
  return canvas.toDataURL("image/png");
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
  const d=signatureDocument.debt;
  const phrase=`Bon pour reconnaissance de dette de ${d.amount_in_words} euros (${money(d.amount)}).`;
  pageShell(`<section class="signature-paper stack"><div><p class="pill">MOOV IN CAB · DOCUMENT À SIGNER</p><h1>Reconnaissance de dette</h1><p class="muted">Veuillez vérifier les informations avant de signer. Le lien est individuel et temporaire.</p></div>${noticeHtml()}<div class="detail-grid"><div class="detail-item"><span>Créancier</span><strong>${esc(d.creditor_name)}</strong></div><div class="detail-item"><span>Débiteur</span><strong>${esc(d.debtor_name)}</strong></div><div class="detail-item"><span>Montant total</span><strong>${money(d.amount)}</strong></div><div class="detail-item"><span>Motif</span><strong>${esc(d.reason)}</strong></div></div><div><h3>Échéancier de remboursement</h3><div class="table-wrap"><table><thead><tr><th>N°</th><th>Échéance</th><th>Montant</th></tr></thead><tbody>${(signatureDocument.installments||[]).map(i=>`<tr><td>${i.sequence_no}</td><td>${date(i.due_date)}</td><td>${money(i.amount)}</td></tr>`).join("")}</tbody></table></div></div><div class="notice">Vérifiez le montant et l'échéancier. La mention ci-dessous sera ajoutée au document. Pour valider, cochez obligatoirement « Bon pour accord » et apposez votre signature manuscrite dans la zone prévue.</div><div class="phrase">${esc(phrase)}</div><form id="signatureForm" class="stack"><div class="field"><label for="debtorDob">Date de naissance</label><input id="debtorDob" name="debtor_dob" type="date" required max="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Signature manuscrite obligatoire</label><div class="canvas-wrap"><canvas id="signatureCanvas" class="signature-canvas" aria-label="Zone pour dessiner la signature"></canvas><div class="canvas-tools"><span>Signez avec votre doigt ou votre souris.</span><button type="button" class="btn secondary small-btn" data-action="clear-canvas" data-id="signatureCanvas">Effacer</button></div></div></div><label class="checkbox"><input type="checkbox" name="accepted" required><span><strong>Bon pour accord.</strong> Je confirme avoir lu le document, reconnaître la dette du montant indiqué et accepter l'échéancier de remboursement. Je comprends que ma signature sera enregistrée avec la date et des données techniques de connexion.</span></label><button class="btn" type="submit">Confirmer et signer</button><p class="help">La date de naissance est déclarative. Cette signature n'est pas une signature électronique qualifiée avec vérification officielle de l'identité.</p></form></section>`);
  canvasInit("signatureCanvas");
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
root.addEventListener("submit", async (event) => {
  event.preventDefault(); const form=event.target; const submit=form.querySelector('[type="submit"]'); if(submit)submit.disabled=true;
  try {
    if(form.id==="loginForm") {
      const fd=new FormData(form); const {error}=await supabase.auth.signInWithPassword({email:fd.get("email"),password:fd.get("password")}); if(error)throw error; notice=null; await boot();
    } else if(form.id==="createForm") {
      const fd=new FormData(form); const body=Object.fromEntries(fd.entries()); body.amount=Number(body.amount);body.installment_count=Number(body.installment_count);
      const {data,error}=await supabase.functions.invoke("create-debt",{body});if(error)throw error;
      if(data?.ok!==true || data?.emailSent!==true) throw new Error(data?.error || "La création n'a pas été confirmée et l'e-mail n'est pas confirmé comme envoyé.");
      setNotice("Dossier créé et lien de signature envoyé au débiteur.","success");
      await loadDashboard();view="dashboard";renderDashboard();
    } else if(form.id==="inviteForm") {
      const fd=new FormData(form);const {data,error}=await supabase.functions.invoke("invite-user",{body:Object.fromEntries(fd.entries())});if(error)throw error;setNotice(data?.message||"Invitation envoyée.","success");await loadDashboard();view="dashboard";renderDashboard();
    } else if(form.id==="signatureForm") {
      const sig=document.getElementById("signatureCanvas");
      if(!sig?._isDrawn?.())throw new Error("Veuillez apposer votre signature manuscrite avant de continuer.");
      const fd=new FormData(form);
      if(fd.get("accepted")!=="on")throw new Error("Veuillez cocher la case « Bon pour accord » pour valider.");
      const payload={token,debtor_dob:fd.get("debtor_dob"),accepted:true,mention_png:textToPng(phrase),signature_png:sig.toDataURL("image/png")};
      const {data,error}=await supabase.functions.invoke("sign-debt",{body:payload});if(error)throw error;signatureDocument={signed:true,message:data?.message||"Votre signature a été enregistrée."};setNotice(null);await renderSignature();
    }
  } catch(e) { setNotice(await detailedErrorMessage(e),"error"); if(form.id==="signatureForm"){await renderSignature();}else if(form.id==="loginForm"){renderLogin();}else if(form.id==="createForm"){renderCreate();}else if(form.id==="inviteForm"){renderInvite();} }
  finally { const active=root.querySelector('form [type="submit"]'); if(active)active.disabled=false; }
});
root.addEventListener("click", async (event) => {
  const button=event.target.closest("[data-action]");if(!button)return;
  const action=button.dataset.action;const id=button.dataset.id;
  try {
    if(action==="new"){notice=null;view="create";renderCreate();}
    else if(action==="invite"){notice=null;view="invite";renderInvite();}
    else if(action==="back"||action==="refresh"){notice=null;await loadDashboard();view="dashboard";renderDashboard();}
    else if(action==="logout"){await supabase.auth.signOut();session=null;profile=null;debts=[];notice=null;renderLogin();}
    else if(action==="detail"){selectedDebtId=id;view="detail";notice=null;renderDetail(debts.find(d=>d.id===id));}
    else if(action==="resend"){button.disabled=true;const {data,error}=await supabase.functions.invoke("resend-signature-link",{body:{debt_id:id}});if(error)throw error;if(data?.warning){setNotice(data.warning,"error");}else{setNotice(data?.message||"Nouveau lien envoyé.","success");}await loadDashboard();view="detail";renderDetail(debts.find(d=>d.id===selectedDebtId));}
    else if(action==="download"){const downloadWindow=window.open("about:blank","_blank");button.disabled=true;const {data,error}=await supabase.functions.invoke("download-signed-pdf",{body:{debt_id:id}});if(error){downloadWindow?.close();throw error;}if(!data?.url){downloadWindow?.close();throw new Error("Lien de téléchargement manquant.");}if(downloadWindow)downloadWindow.location.href=data.url;else location.href=data.url;button.disabled=false;}
    else if(action==="mark"){button.disabled=true;const {error}=await supabase.functions.invoke("mark-installment",{body:{installment_id:id,paid:button.dataset.paid==="true"}});if(error)throw error;await loadDashboard();view="detail";renderDetail(debts.find(d=>d.id===selectedDebtId));}
    else if(action==="clear-canvas"){document.getElementById(id)?._clear?.();}
  } catch(e){setNotice(await detailedErrorMessage(e),"error");if(view==="detail")renderDetail(debts.find(d=>d.id===selectedDebtId));else renderDashboard();}
});
supabase?.auth.onAuthStateChange((_event,newSession)=>{session=newSession; if(!token) setTimeout(()=>boot().catch(e=>{setNotice(errorMessage(e),"error");renderLogin();}),0);});
boot().catch(e=>{setNotice(errorMessage(e),"error");renderLogin();});

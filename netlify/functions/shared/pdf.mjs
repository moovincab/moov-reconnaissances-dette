import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import {LOGO} from './logo.mjs';
import {fmtDate,fmtCents} from './core.mjs';
export function tens(n){const u=['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];if(n<20)return u[n];if(n<70){let dec=Math.floor(n/10),v=n%10,s=['','','vingt','trente','quarante','cinquante','soixante'][dec];return v===0?s:v===1?s+' et un':s+'-'+u[v];}if(n<80)return n===71?'soixante et onze':'soixante-'+tens(n-60);if(n===80)return 'quatre-vingts';return 'quatre-vingt-'+tens(n-80);}
function hundreds(n){if(n<100)return tens(n);let h=Math.floor(n/100),r=n%100,p=h===1?'cent':tens(h)+' cent';return r?p+' '+tens(r):(h>1?p+'s':p);}
function numWords(n){if(n<1000)return hundreds(n);if(n<1e6){let x=Math.floor(n/1000),r=n%1000;return (x===1?'mille':hundreds(x).replace(/cents$/,'cent')+' mille')+(r?' '+hundreds(r):'');}if(n<1e9){let x=Math.floor(n/1e6),r=n%1e6;return (x===1?'un million':numWords(x)+' millions')+(r?' '+numWords(r):'');}let x=Math.floor(n/1e9),r=n%1e9;return (x===1?'un milliard':numWords(x)+' milliards')+(r?' '+numWords(r):'');}
export function amountWords(c){let e=Math.floor(c/100),r=c%100;return numWords(e)+(e>1?' euros':' euro')+(r?' et '+numWords(r)+(r>1?' centimes':' centime'):'');}
function safeText(s){return String(s??'').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\u00a0/g,' ').replace(/[\u202f]/g,' ').replace(/\u2022/g,'-').replace(/\u0153/g,'oe').replace(/\u0152/g,'OE').replace(/[\u200b-\u200f]/g,'').replace(/[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u00FF\u20AC]/g,'?');}
export async function makePdf(r,items,sign,meta){
 const doc=await PDFDocument.create(),reg=await doc.embedFont(StandardFonts.TimesRoman),bold=await doc.embedFont(StandardFonts.TimesRomanBold),italic=await doc.embedFont(StandardFonts.TimesRomanItalic);
 const black=rgb(.10,.12,.16),muted=rgb(.42,.46,.51),W=595.28,H=841.89,L=49,R=49,inner=W-L-R;let page,y,pageNo=0;
 function newPage(){page=doc.addPage([W,H]);pageNo++;y=H-48;page.drawText('MOOV IN CAB  |  Reconnaissance de dette  |  '+r.ref,{x:L,y:22,size:8,color:muted,font:reg});}
 function ensure(h=25){if(y-h<58)newPage();}
 function line(t,opts={}){let {size=11,font=reg,gap=7,indent=0}=opts;const max=inner-indent;const parts=safeText(t).split('\n');for(const para of parts){let arr=[];for(const word of para.split(/\s+/)){if(!word)continue;let test=[...arr,word].join(' ');if(font.widthOfTextAtSize(test,size)<=max){arr.push(word);}else{if(arr.length){ensure(size+gap);page.drawText(arr.join(' '),{x:L+indent,y,size,font,color:black});y-=size+gap;arr=[];}if(font.widthOfTextAtSize(word,size)>max){let part='';for(const ch of word){if(font.widthOfTextAtSize(part+ch,size)>max&&part){ensure(size+gap);page.drawText(part,{x:L+indent,y,size,font,color:black});y-=size+gap;part='';}part+=ch;}arr=[part];}else arr=[word];}}
   ensure(size+gap);page.drawText(arr.join(' '),{x:L+indent,y,size,font,color:black});y-=size+gap;}
 }
 function space(p=8){y-=p;}
 function heading(s){space(9);line(s,{font:bold,size:12,gap:7});space(1);}
 async function ink(v,x,top,w,h){if(!v)return;try{const b=Buffer.from(v.split(',')[1],'base64'),img=await doc.embedPng(b);const dim=img.scaleToFit(w,h);page.drawImage(img,{x:x+(w-dim.width)/2,y:top-h+(h-dim.height)/2,width:dim.width,height:dim.height});}catch{}}
 newPage();
 try{const logo=await doc.embedPng(Buffer.from(LOGO,'base64'));const dim=logo.scaleToFit(193,46);page.drawImage(logo,{x:(W-dim.width)/2,y:y-dim.height,width:dim.width,height:dim.height});y-=dim.height+30;}catch{}
 ensure(30);let title='RECONNAISSANCE DE DETTE';page.drawText(title,{x:(W-bold.widthOfTextAtSize(title,17))/2,y,font:bold,size:17,color:black});y-=36;
 line('Entre les soussignés :');space(8);line('Le créancier :',{font:bold});
 line('Société : '+r.data.creditor_name);line('Adresse : '+r.data.creditor_address);line('SIREN : '+r.data.creditor_siren);line('Représentée par : '+r.data.creditor_representative+', en qualité de représentant légal');
 space(9);line('Et',{font:bold});space(8);line('Le débiteur :',{font:bold});
 line('Nom et prénom : '+r.debtor_name);line('Date de naissance : '+fmtDate(r.data.debtor_birth));line('Adresse : '+r.data.debtor_address);line('Téléphone : '+(r.data.debtor_phone||'non communiqué'));line('Adresse e-mail : '+r.debtor_email);
 heading('Article 1 - Objet');line('Je soussigné, '+r.debtor_name+', reconnais devoir à la société '+r.data.creditor_name+' la somme de :');line(fmtCents(r.amount_cents),{font:bold,size:14});line('('+amountWords(r.amount_cents)+')',{font:italic});
 line('au titre de '+r.data.reason+', liés au contrat de location du véhicule :');line('Véhicule : '+r.data.vehicle);line('Immatriculation : '+r.data.plate);line('Contrat de location signé le : '+fmtDate(r.data.contract_date));
 heading('Article 2 - Modalités de remboursement');line('Le débiteur s’engage à rembourser la dette selon les modalités suivantes :');
 if(items.length===1){line('Paiement comptant au plus tard le '+fmtDate(items[0].due_date)+' : '+fmtCents(items[0].amount_cents));}
 else{line('Paiement échelonné en '+items.length+' échéances :');for(const i of items)line(' - '+fmtCents(i.amount_cents)+' le '+fmtDate(i.due_date),{indent:13,size:10,gap:5});}
 line('par virement bancaire sur le compte du créancier.');
 heading('Article 3 - Défaut de paiement');line('En cas de non-respect d’une échéance :');line('- la totalité de la somme restante deviendra immédiatement exigible ;');line('- le créancier pourra engager toute procédure de recouvrement judiciaire.');line('Les frais de recouvrement seront à la charge du débiteur.');
 heading('Article 4 - Reconnaissance expresse');line('Le débiteur reconnaît :');line('- devoir la somme indiquée sans contestation ;');line('- renoncer à toute contestation ultérieure concernant l’origine de la dette.');
 heading('Article 5 - Bon pour reconnaissance de dette');line('Fait à '+r.data.place+', le '+fmtDate(meta.date.slice(0,10))+'.');line('Mention écrite par le débiteur lui-même, en chiffres et en toutes lettres :');
 line('Bon pour reconnaissance de dette de '+fmtCents(r.amount_cents)+' ('+amountWords(r.amount_cents)+')',{size:10,font:italic});
 ensure(125);let top=y;page.drawRectangle({x:L,y:y-90,width:inner,height:90,borderColor:rgb(.7,.7,.7),borderWidth:0.5});await ink(sign.mention,L+5,top-5,inner-10,80);y-=111;
 ensure(127);let cTop=y;line('Signature du débiteur :                         Signature du créancier :',{font:bold,size:10});cTop=y;
 page.drawRectangle({x:L,y:cTop-93,width:240,height:93,borderColor:rgb(.7,.7,.7),borderWidth:0.5});page.drawRectangle({x:L+255,y:cTop-93,width:240,height:93,borderColor:rgb(.7,.7,.7),borderWidth:0.5});
 await ink(sign.debtor,L+5,cTop-5,230,84);await ink(r.data.creditor_signature,L+260,cTop-5,230,84);y=cTop-110;
 newPage();line('TRACE DE SIGNATURE ÉLECTRONIQUE SIMPLE',{font:bold,size:14});space(15);
 line('Dossier : '+r.ref);line('Débiteur déclaré : '+r.debtor_name);line('Courriel destinataire : '+r.debtor_email);line('Date de signature (UTC) : '+meta.date);line('Adresse IP de connexion : '+(meta.ip||'Non disponible'));line('Navigateur : '+(meta.agent||'Non communiqué'),{size:9});line('Accord : le signataire a confirmé avoir lu le document et approuvé expressément son engagement.');
 space(14);line('La signature apposée est une signature électronique simple. Cette trace et le PDF permettent de documenter la démarche, sans certification qualifiée de l’identité ni horodatage qualifié.',{size:10});
 doc.setTitle('Reconnaissance de dette '+r.ref);doc.setSubject('Reconnaissance de dette signée électroniquement');doc.setCreator('MOOV IN CAB - application de reconnaissance de dette');doc.setCreationDate(new Date(meta.date));
 return new Uint8Array(await doc.save());
}

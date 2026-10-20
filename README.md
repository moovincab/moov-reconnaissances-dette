# MOOV IN CAB — Reconnaissances de dette — Version en ligne

**Livrable complet de code**, à connecter à des services externes pour mise en production : Netlify + Supabase + Resend.

## 1. Ce que fait l'application

- Connexion par compte pour chaque gestionnaire (mot de passe Supabase).
- Dossiers de reconnaissances de dette reprenant le courrier MOOV IN CAB transmis : créancier, chauffeur, contrat, véhicule, articles 1 à 5, reconnaissance du montant en chiffres et en toutes lettres.
- Échéancier automatique **hebdomadaire ou mensuel** et possibilité de modifier individuellement dates et montants.
- Affectation d'un dossier à un collaborateur autorisé.
- Envoi **par e-mail** d'un lien personnel de signature valable **14 jours** ; le lien précédent est révoqué lorsqu'un nouveau lien est envoyé.
- Sur le téléphone du chauffeur : lecture du texte intégral, vérification déclarative du nom et de la date de naissance, **mention manuscrite tracée à l'écran**, signature tracée à l'écran et consentement explicite.
- Création côté serveur d'un PDF avec les signatures, la date, l'adresse IP et des éléments de traçabilité ; **empreinte SHA-256** dans le registre ; PDF stocké dans un bucket Supabase privé et accessible uniquement aux salariés autorisés.
- Archivage partagé entre salariés, dossiers signés verrouillés, journal de signature/versements.
- Pointage manuel de chaque échéance « payée » ou « non payée ».
- **Rappel automatique par e-mail au collaborateur responsable** : J-3, J0, J+1, J+7, J+14, puis chaque semaine de retard ; plus de rappel après pointage comme « payé ».
- Invitation par e-mail d'autres gestionnaires depuis l'interface administrateur.

Les rappels **ne sont pas envoyés aux chauffeurs** : ils servent à relancer le responsable interne. Le code n'intègre ni banque ni SMS. Le statut « payé » repose sur la saisie du gestionnaire.

## 2. Création du projet Supabase

1. Créer un nouveau projet sur https://supabase.com/dashboard (idéalement **dédié à cet outil**).
2. Aller dans **SQL Editor > New query**, copier le contenu de `supabase/schema.sql`, puis lancer **Run**. Cela crée les tables, active la sécurité RLS et crée le bucket privé `debt-archives`.
3. Dans **Authentication > Providers > Email**, activer la connexion par e-mail et mot de passe. Pour empêcher la création de comptes publics, **désactiver « Allow new users to sign up »**. Les invitations du personnel restent gérées par l'administrateur.
4. Dans **Authentication > URL Configuration**, ajouter le futur domaine Netlify comme **Site URL** et dans les **Redirect URLs** (ex. `https://moov-dette.netlify.app/**`). Les invitations et réinitialisations doivent revenir vers l'application.
5. Dans **Authentication > Users > Add user**, créer un premier compte de gestionnaire avec son vrai e-mail et un mot de passe choisi dans Supabase. Cocher la confirmation d'e-mail si nécessaire selon le parcours retenu.
6. Dans SQL Editor, exécuter **en remplaçant l'e-mail** :

```sql
insert into public.staff (user_id, full_name, email, role)
select id, 'Viktor', email, 'admin'
from auth.users
where email = 'VOTRE_EMAIL_PROFESSIONNEL'
on conflict (user_id) do update
set role = 'admin', active = true;
```

> Ne pas créer de « staff » à partir d'une adresse inconnue. Le gestionnaire doit exister dans `auth.users`.

## 3. Envoi d'e-mails Resend

1. Ouvrir https://resend.com et créer un compte.
2. Dans **Domains**, ajouter un domaine que votre entreprise possède. Ajouter les entrées DNS demandées pour la vérification.
3. Générer une clé API d'envoi.
4. Définir comme adresse émettrice une adresse appartenant au domaine vérifié, par exemple `MOOV IN CAB <signatures@votre-domaine.fr>`.

La même clé Resend assure les e-mails de **signature** et les **rappels d'échéance**. L'offre et les éventuels coûts dépendent du volume et du prestataire. Ne pas utiliser l'adresse de test Resend pour une utilisation avec de vrais chauffeurs.

## 4. Déployer sur Netlify (avec les fonctions serveur)

**Important : ne pas utiliser uniquement Netlify Drop / le glisser-déposer d'un dossier HTML.** Cette version contient des fonctions serveur et un traitement planifié ; elle doit être déployée par un projet Git relié à Netlify, ou avec la **CLI Netlify** et l'option de build.

### Méthode recommandée : GitHub → Netlify

1. Décompresser le ZIP, déposer **tous** les fichiers du dossier dans un dépôt GitHub privé.
2. Sur Netlify, **Add new project > Import an existing project** et relier le dépôt.
3. Laisser Netlify lire automatiquement `netlify.toml` : dossier publié `public`, fonctions `netlify/functions`. Installer les dépendances avec `npm install` (Netlify détecte `package.json`). Si Netlify exige une commande de build, choisir `npm install` ; aucune compilation frontend nécessaire.
4. Ajouter les variables de `.env.example` dans **Site configuration > Environment variables** (scope : Functions et Builds) :

| Variable | Source | Sensibilité |
|---|---|---|
| `SUPABASE_URL` | Supabase > Project URL | Publique |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase > API keys > publishable | Publique |
| `SUPABASE_SECRET_KEY` | Supabase > API keys > secret | **SECRÈTE, serveur uniquement** |
| `RESEND_API_KEY` | Resend > API Keys | **SECRÈTE, serveur uniquement** |
| `MAIL_FROM` | Votre domaine Resend vérifié | Paramètre |
| `SITE_URL` | URL publique Netlify, avec `https://` sans `/` final | Paramètre |

Le projet reconnaît aussi les **anciennes clés** `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY`, si elles existent sur un ancien projet. Dans ce cas ne mettez pas une ancienne clé dans la variable `SUPABASE_SECRET_KEY` et son inverse : leur type est détecté.

5. Déployer le projet en production. Vérifier que `https://votre-site.netlify.app/api/config` indique `"ready":true` **sans exposer la clé secrète**.
6. Vérifier dans **Netlify > Functions** que `admin`, `sign`, `config` et `reminders` existent. La fonction `reminders` doit afficher **Scheduled**.
7. Se connecter avec votre premier compte et tester un dossier sur une vraie boîte e-mail, une signature, le téléchargement du PDF et un rappel manuel en cliquant sur **Run now** pour `reminders` dans Netlify (créer une échéance de test à J0). Netlify exécute le job automatiquement uniquement sur les **déploiements publiés**, à **07:00 UTC** (8 h l'hiver et 9 h l'été à Paris).

### Variante CLI

Pour une personne à l'aise avec le terminal : dans le dossier du projet, exécuter `npm install`, puis `npx netlify login`, `npx netlify init`, `npx netlify deploy --build --prod`. Ajouter les variables d'environnement dans Netlify avant le déploiement de production.

## 5. Utilisation au quotidien

1. **Nouveau dossier** > renseigner chauffeur, e-mail, montant, véhicule, contrat et responsable des rappels.
2. **Générer automatiquement** l'échéancier ; corriger les dates et montants si besoin. Enregistrer.
3. Depuis le dossier **Envoyer à signer** : un e-mail avec lien personnel part au chauffeur.
4. Le chauffeur lit le document, inscrit au doigt la mention contenant le montant **en chiffres et en lettres** et signe.
5. Le statut passe à **Signé / archivé**. Le bouton **Télécharger le PDF signé** télécharge la pièce archivée. On retrouve l'empreinte et la date de signature.
6. Quand un règlement est effectivement reçu, ouvrir le dossier et cliquer sur **Marquer payé** pour l'échéance. Le rappel s'arrête sur celle-ci.
7. Dans **Gestion des collaborateurs**, inviter un autre salarié. Affecter ses futurs dossiers à son compte pour qu'il reçoive les rappels correspondants.

## 6. Sécurité et limites juridiques importantes

- Une signature dessinée à l'écran, même horodatée dans un journal et accompagnée d'une preuve de possession d'un lien e-mail, reste ici une **signature électronique simple**. Elle **n'est ni qualifiée eIDAS ni certifiée par un prestataire de confiance**. L'adresse IP, l'e-mail et la date de naissance déclarée ne prouvent pas avec certitude l'identité du signataire. Pour un recouvrement contentieux fréquent, faire valider le dispositif et envisager un prestataire de signature avancée/qualifiée et un dossier de preuves opposable.
- **Article 1376 du Code civil** : pour un engagement unilatéral de paiement, la mention de la somme en toutes lettres **et en chiffres**, écrite par le débiteur lui-même, et sa signature constituent des exigences probatoires. L'interface impose un espace de tracé manuscrit, mais **n'effectue aucune reconnaissance OCR** ; un gestionnaire doit contrôler que la mention manuscrite est exacte avant d'invoquer le document.
- Les articles 3 et 4 du courrier d'origine, en particulier les clauses de frais de recouvrement et de renonciation aux contestations, sont repris **sans validation de leur opposabilité**. Faites-les contrôler par un juriste, selon les cas concernés.
- Données sensibles (état civil, coordonnées, créances, signatures, adresses IP) : informer les personnes, choisir une durée de conservation adaptée, prévoir une procédure d'accès/suppression conforme à vos obligations RGPD. Le projet n'intègre pas un module RGPD de purge automatique.
- Les jetons personnels ne sont pas stockés en clair dans la base : seul leur hash SHA-256 est conservé. Ils expirent après 14 jours et sont invalidés à la signature.
- Les PDFs sont privés ; la clé secrète Supabase reste exclusivement dans les fonctions serveur. Ne jamais la publier dans un fichier frontend, un e-mail ou GitHub.
- L'outil n'est **pas** un service automatisé de constat bancaire : les versements sont confirmés manuellement.
- Exécuter un test de bout en bout avec les services réellement connectés avant usage en production.

## 7. Fichiers

```
public/                 application bureau / mobile
netlify/functions/       API serveur, PDF et rappel quotidien
netlify/functions/shared/ logo, gestion base, génération PDF
supabase/schema.sql     modèle de base, sécurité et bucket privé
netlify.toml            configuration de publication et fonction planifiée
.env.example            noms des variables à définir sur Netlify
```

Cette application est un **projet déployable**, pas un site déjà publié. Le ZIP ne contient ni clés API, ni accès Netlify, ni domaine Resend.

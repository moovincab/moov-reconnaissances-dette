# MOOV IN CAB — Frontend statique + Supabase (OVH / GitHub Pages)

Application statique avec backend Supabase Edge Functions. Le site de production prévu est https://reconnaissances.moov-in-cab.fr/ ; le workflow GitHub Pages peut continuer à publier une copie tant qu’il reste activé. Le code du site est public, mais les données et les PDF signés restent dans Supabase avec accès privé.

## Fonctionnalités incluses

- Connexion de l'équipe avec Supabase Auth (comptes créés par invitation, pas d'inscription publique).
- Tableau de bord des reconnaissances de dette, recherche, détail et échéancier.
- Création d'un dossier avec créancier prérempli MOOV IN CAB, sélection ou ajout de plusieurs créanciers, et copie des informations du créancier dans chaque reconnaissance.
- PDF de reconnaissance de dette structuré en cinq articles selon le modèle fourni, avec les données du débiteur, le véhicule, le contrat de location et le choix entre paiement comptant ou échelonné.
- Répartition du montant sur des échéances hebdomadaires ou mensuelles et choix d'un responsable de rappels.
- Envoi et renvoi d'un lien de signature par e-mail valable 14 jours (les anciens liens sont invalidés au renvoi).
- Page de signature adaptée au mobile : date de naissance déclarée, mention manuscrite dessinée, signature dessinée et confirmation explicite.
- Génération serveur du PDF signé et archivage dans un bucket Supabase privé ; empreinte SHA-256 du fichier final conservée en base, et empreinte distincte des données contractuelles et signatures imprimée dans le PDF.
- Téléchargement d'un PDF par lien privé temporaire (60 secondes).
- Rappels par e-mail au responsable du dossier : jusqu'à J-3, à l'échéance, J+1, J+7, J+14 puis chaque semaine pour une échéance toujours impayée.
- Marquage manuel des échéances payées ; les rappels s'arrêtent lorsque l'échéance est payée et le dossier passe à « Remboursée » lorsque tout est réglé.
- Invitation de collaborateurs depuis le compte administrateur.

**Pas de SMS dans cette version.** Le paiement n'est pas vérifié automatiquement : un collaborateur doit mettre à jour le statut de l'échéance.

## Architecture

- **GitHub Pages** : sert `index.html`, `assets/` et `config.js`.
- **Supabase Auth + Postgres + Storage** : comptes, données, échéances et archive PDF privée.
- **Supabase Edge Functions** : création de dossiers, invitation, signature, génération PDF, téléchargement et rappels.
- **Supabase Cron + pg_net + Vault** : déclenche le traitement quotidien des rappels à 08:00 UTC.
- **Resend** : envoi des e-mails de signature et de rappel.

Aucun Netlify ni serveur personnel n'est nécessaire. Les fonctions serveur sont hébergées par Supabase.

---

## 1. Créer le dépôt GitHub et publier le frontend

Le dépôt GitHub reste la source du code. L’hébergement OVH configuré pour `reconnaissances.moov-in-cab.fr` sert le site de production. Le workflow `.github/workflows/pages.yml` publie aussi sur GitHub Pages tant qu’il reste activé ; ne le supprimez pas sans décider explicitement si cette copie doit être conservée.

Le dépôt peut être public pour utiliser GitHub Pages gratuitement. Il ne doit contenir **aucun PDF client, aucune donnée réelle de débiteur et aucun secret**. Le code client et la clé Supabase `anon` sont publics par conception ; la sécurité repose sur les politiques SQL et les fonctions serveur.

## 2. Créer Supabase et la base de données

1. Créez un projet sur https://supabase.com/dashboard et conservez le mot de passe de base de données en lieu sûr.
2. Dans **SQL Editor**, ouvrez `supabase/migrations/20261020000000_init.sql` et exécutez tout le script.
3. Exécutez ensuite, dans cet ordre, `supabase/migrations/20261029120000_creditors_pdf_template.sql`, puis `supabase/migrations/20261029121000_rls_security_hardening.sql`. Ces migrations ajoutent les créanciers et les champs du modèle, puis limitent la lecture des dossiers aux utilisateurs autorisés. Elles sont additives et ne remplacent pas la migration initiale.
4. Dans **Authentication → URL Configuration**, définissez `Site URL` sur `https://reconnaissances.moov-in-cab.fr/` et ajoutez cette URL aux `Redirect URLs`. Gardez la barre oblique finale. Faites de même pour les autres URL réellement utilisées, si vous conservez une copie GitHub Pages.
5. Dans **Authentication → Providers → Email**, désactivez les inscriptions publiques si elles sont activées. Configurez un SMTP de production pour les invitations et les e-mails d'authentification ; le service de test Supabase est limité.

### Créer le premier administrateur

1. Dans **Authentication → Users**, créez votre propre utilisateur avec votre adresse e-mail et confirmez-le.
2. Dans **SQL Editor**, remplacez l'adresse ci-dessous par la vôtre puis exécutez :

```sql
update public.profiles
set role = 'admin'
where email = 'votre-adresse@exemple.fr';
```

Le profil est créé automatiquement par le déclencheur SQL lors de la création du compte. Connectez-vous au site avec ce compte.

## 3. Configurer le frontend GitHub Pages

Dans le dépôt GitHub, ouvrez `config.js` et remplacez les valeurs de démonstration par celles de **Supabase → Project Settings → API** :

```js
window.MOOV_CONFIG = {
  SUPABASE_URL: "https://VOTRE-PROJET.supabase.co",
  SUPABASE_ANON_KEY: "VOTRE_CLE_ANON_PUBLIQUE"
};
```

Utilisez uniquement l'URL du projet et la clé publique `anon`/publishable. **N'utilisez jamais `service_role`, `secret key`, `RESEND_API_KEY` ou `MOOV_CRON_SECRET` dans `config.js`.** Enregistrez le changement ; GitHub Actions republiera le site.

## 4. Déployer les fonctions serveur Supabase

Installez le CLI Supabase depuis la documentation officielle : https://supabase.com/docs/guides/cli. Puis, dans un terminal, à la racine de ce dossier :

```bash
supabase login
supabase link --project-ref VOTRE_PROJECT_REF
```

Le `PROJECT_REF` est l'identifiant du projet visible dans l'URL Supabase ou dans les paramètres du projet. Déployez les fonctions :

```bash
supabase functions deploy create-debt
supabase functions deploy manage-creditors
supabase functions deploy get-signature-document
supabase functions deploy sign-debt
supabase functions deploy invite-user
supabase functions deploy resend-signature-link
supabase functions deploy download-signed-pdf
supabase functions deploy mark-installment
supabase functions deploy send-reminders
```

Supabase fournit automatiquement aux Edge Functions `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`. Ne copiez pas la clé service role dans GitHub.

## 5. Configurer l'envoi d'e-mails Resend

1. Créez un compte sur https://resend.com.
2. Ajoutez et vérifiez votre domaine d'envoi dans Resend (configuration DNS demandée par Resend).
3. Créez une clé API Resend.
4. Définissez les secrets des fonctions Supabase. Exemple bash (remplacez chaque valeur) :

```bash
supabase secrets set APP_URL="https://reconnaissances.moov-in-cab.fr/" RESEND_API_KEY="re_VOTRE_CLE_RESEND" RESEND_FROM="MOOV IN CAB <signatures@votre-domaine.fr>" MOOV_CRON_SECRET="VOTRE_SECRET_ALEATOIRE_LONG"
```

Cette commande sur une seule ligne fonctionne aussi dans PowerShell ; remplacez les exemples avant de l'exécuter.

`APP_URL` doit être l'URL exacte de production `https://reconnaissances.moov-in-cab.fr/`. Cette valeur sert aux liens de signature et aux liens des e-mails de rappel. Après toute modification, redéployez les fonctions si nécessaire et vérifiez les Redirect URLs dans Supabase Auth. Générez un secret aléatoire long pour `MOOV_CRON_SECRET`, par exemple avec `openssl rand -hex 32`. Utilisez **exactement la même valeur** pour le secret de fonction et pour Vault à l'étape suivante.

Les liens de signature expirent après 14 jours. Si Resend échoue à l'envoi initial, le dossier est conservé et l'interface affiche un avertissement. Ouvrez le dossier et cliquez sur « Renvoyer le lien de signature » après avoir corrigé la configuration.

## 6. Activer les rappels automatiques

Les rappels utilisent les extensions Supabase **pg_cron**, **pg_net** et **Supabase Vault**. Dans le tableau de bord Supabase, activez-les dans Database → Extensions si elles ne sont pas déjà activées.

1. Dans **Database → Vault**, créez deux secrets :
   - `moov_supabase_url` = `https://VOTRE_PROJECT_REF.supabase.co`
   - `moov_cron_secret` = la même valeur que `MOOV_CRON_SECRET` configurée à l'étape 5.
2. Dans **SQL Editor**, exécutez le contenu de `supabase/setup-cron.sql`.
3. Vérifiez la tâche :

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'moov-daily-reminders';
```

La tâche est planifiée chaque jour à **08:00 UTC**. Le traitement envoie un rappel au collaborateur affecté au dossier. Il ne rappelle que les échéances dont le dossier est signé et dont le statut est toujours impayé. Les erreurs d'envoi sont retournées dans la réponse de la fonction et peuvent être consultées dans les logs Edge Functions.

Pour supprimer la tâche, si besoin :

```sql
select cron.unschedule('moov-daily-reminders');
```

## 7. Vérifications de mise en service

Avant de saisir des données réelles :

- Connectez-vous avec le compte administrateur.
- Invitez un collaborateur de test ; vérifiez le SMTP Supabase si l'invitation n'arrive pas.
- Créez un dossier de test avec le créancier MOOV IN CAB prérempli, puis ajoutez un deuxième créancier pour vérifier la sélection.
- Testez un paiement comptant et un paiement échelonné ; vérifiez que chaque échéance apparaît correctement dans le PDF.
- Ouvrez le lien de signature sur un téléphone et testez la mention manuscrite et la signature.
- Vérifiez dans Supabase Storage que le PDF se trouve dans le bucket privé `signed-debt-documents` et qu'il n'est pas public.
- Téléchargez le PDF depuis le tableau de bord ; le lien de téléchargement expire au bout de 60 secondes.
- Testez une échéance en environnement de test avant de compter sur les rappels automatiques. Le cron se lance quotidiennement, pas immédiatement après la création.
- Contrôlez **Edge Functions → Logs**, **Database → Cron Jobs** et les logs Resend.

## Sécurité et limites importantes

- Le frontend est public ; les données sont protégées côté base par RLS. Les fonctions qui écrivent dans la base utilisent `service_role` côté serveur et vérifient la session utilisateur pour les actions internes.
- Les demandes de signature publiques utilisent un jeton aléatoire dont seul le hash est stocké ; les PDF sont archivés dans un bucket privé et servis avec un lien temporaire.
- La date de naissance est déclarative, l'adresse IP et le navigateur sont des traces techniques, pas une preuve absolue d'identité. Cette solution n'est pas une signature électronique qualifiée eIDAS et ne remplace pas une vérification d'identité forte.
- Faites vérifier le modèle de reconnaissance de dette, la mention manuscrite et le processus de signature par un professionnel du droit avant usage opérationnel. La validité dépend notamment des circonstances et des règles applicables, pas uniquement du PDF.
- Prévoir une politique de conservation, de sauvegarde et de suppression des données personnelles conformément au RGPD.
- Les rappels sont des e-mails, pas des SMS. Les paiements doivent être marqués manuellement dans l'application.

## Dépannage rapide

- **Le site indique « Configuration nécessaire »** : vérifiez `config.js`, puis attendez la fin de GitHub Actions.
- **Erreur « Failed to fetch »** : vérifiez l'URL Supabase, la clé publique et le déploiement des fonctions.
- **Pas d'e-mail de signature** : vérifiez `APP_URL`, `RESEND_API_KEY`, `RESEND_FROM`, le domaine vérifié et les logs de `create-debt`.
- **Pas d'invitation d'équipe** : configurez le SMTP Supabase Auth ; Resend utilisé par les rappels ne configure pas automatiquement les e-mails d'invitation Supabase Auth.
- **Pas de rappels** : vérifiez `MOOV_CRON_SECRET` côté fonction et Vault, l'activation de `pg_cron`/`pg_net`, le job Cron et les logs de `send-reminders`.

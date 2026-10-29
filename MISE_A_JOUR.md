# Mise à jour MOOV IN CAB — créanciers et nouveau PDF

Ce dossier contient les changements de code préparés à partir de l'archive fournie. Ils n'ont pas été déployés et n'ont modifié aucune base Supabase ni configuration OVH.

## Avant de commencer

1. Fais une sauvegarde du dépôt GitHub (ou télécharge une copie ZIP de la version actuelle).
2. Dans Supabase, exporte/sauvegarde les données importantes avant de modifier les politiques RLS.
3. Vérifie que ton compte d'administration fonctionne. Le rôle attendu dans `public.profiles.role` est `admin`.
4. Ne déploie pas les changements tant que `https://reconnaissances.moov-in-cab.fr/` n'affiche pas un certificat SSL valide dans le navigateur.

## 1. Mettre à jour le code

Publie les fichiers de cette archive dans le dépôt GitHub en conservant la structure des dossiers. Ne remplace pas la migration initiale `20261020000000_init.sql` dans Supabase : les deux nouvelles migrations sont additives.

## 2. Exécuter les migrations SQL dans l'ordre

Dans **Supabase → SQL Editor**, ouvre et exécute le contenu de ces fichiers, un par un, dans cet ordre :

1. `supabase/migrations/20261029120000_creditors_pdf_template.sql`
2. `supabase/migrations/20261029121000_rls_security_hardening.sql`

La première crée le créancier par défaut MOOV IN CAB, la table des autres créanciers et les champs du modèle. La deuxième resserre la lecture des données : un collaborateur ne voit que les dossiers qu'il a créés ou qui lui sont attribués ; un administrateur peut voir tous les dossiers.

**Important :** la deuxième migration change les règles de visibilité des dossiers. Teste avec un compte `admin` et un compte `staff`. Si l'organisation attend que tous les collaborateurs voient tous les dossiers, il faudra adapter la règle avant de l'appliquer en production.

## 3. Déployer les Edge Functions

Dans un terminal avec le CLI Supabase installé, à la racine du dépôt :

```bash
supabase login
supabase link --project-ref lbknrqcucwvsryxbhvrl
supabase functions deploy create-debt
supabase functions deploy manage-creditors
supabase functions deploy get-signature-document
supabase functions deploy sign-debt
supabase functions deploy mark-installment
supabase functions deploy resend-signature-link
supabase functions deploy download-signed-pdf
supabase functions deploy invite-user
supabase functions deploy send-reminders
```

Les fonctions utilisent les secrets déjà configurés. Mets à jour uniquement `APP_URL` pour que les liens de signature et les e-mails pointent vers le site OVH :

```bash
supabase secrets set APP_URL="https://reconnaissances.moov-in-cab.fr/"
```

Ne colle jamais la clé `service_role`, `RESEND_API_KEY` ou `MOOV_CRON_SECRET` dans le frontend, dans GitHub ou dans un message.

## 4. Vérifier Supabase Auth et OVH

Dans **Supabase → Authentication → URL Configuration** :

- `Site URL` : `https://reconnaissances.moov-in-cab.fr/`
- `Redirect URLs` : ajoute cette URL exacte.
- Garde une URL GitHub Pages seulement si tu souhaites encore utiliser cette copie du site.

Ne change pas les DNS dans le cadre de cette mise à jour. Si le navigateur signale encore un certificat SSL invalide, règle d'abord ce problème dans OVH.

## 5. Tests à faire avant l'utilisation réelle

- Le formulaire sélectionne par défaut **MOOV IN CAB**, adresse `1 Place Paul Verlaine, 92100 Boulogne-Billancourt`, SIREN `494179377` et représentant `M. Nicolas VEDOVATO, en qualité de représentant légal`.
- Le bouton **+ Ajouter un créancier** enregistre un créancier puis le sélectionne sans effacer les autres champs du dossier.
- Le montant en toutes lettres est calculé automatiquement, y compris les centimes.
- Un dossier de test en paiement comptant affiche la date limite dans le PDF.
- Un dossier de test échelonné affiche chaque échéance, son montant et sa date.
- Le débiteur voit le document complet, saisit sa date de naissance, écrit la mention manuscrite et dessine sa signature.
- Le PDF téléchargé contient les cinq articles, les images réelles de la mention et de la signature, l'empreinte des données/signatures, ainsi que l'horodatage et les traces techniques.
- Le tableau de bord affiche l'empreinte SHA-256 du PDF final. Pour vérifier le fichier téléchargé, compare cette valeur avec le hash calculé localement (Windows PowerShell : `Get-FileHash .\reconnaissance-signee.pdf -Algorithm SHA256`; macOS/Linux : `shasum -a 256 reconnaissance-signee.pdf`).
- Le compte `staff` ne peut ni attribuer un dossier à un autre collaborateur ni consulter/télécharger/renvoyer le lien d'un dossier auquel il n'a pas accès.

## À propos des empreintes SHA-256

Le PDF contient l'empreinte SHA-256 des données contractuelles et des images de signature, calculée avant la génération du PDF. L'empreinte SHA-256 du **fichier PDF final** est calculée après sa création et enregistrée dans Supabase. Il est mathématiquement impossible d'inscrire dans le PDF son propre hash final sans modifier le fichier et donc changer ce hash. Les deux empreintes ont donc des libellés différents et ne doivent pas être confondues.

## Limites

Cette version conserve le parcours de signature existant. Elle ne crée pas de signature du créancier : la zone « Signature du créancier » reste vierge, et aucune signature n'est simulée. Les clauses juridiques des articles 3 et 4 doivent être validées par un juriste avant utilisation opérationnelle.

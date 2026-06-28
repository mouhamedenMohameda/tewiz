# Aloo — Brouillons des fiches stores

Tout ce qui doit être copié-collé dans **App Store Connect** et **Google Play Console** avant la soumission. Édite ici, pas dans les consoles, pour garder un historique versionné.

---

## 1. Nom et identité

| Champ | Valeur |
|---|---|
| Nom de l'app (Apple, 30 car. max) | `Aloo` |
| Nom de l'app (Google, 30 car. max) | `Aloo` |
| Sous-titre App Store (30 car. max) | `Course et chauffeur en Mauritanie` |
| Bundle ID iOS / Package Android | `mr.tewiz.app` |
| Catégorie principale | **Voyages** *(Travel)* |
| Catégorie secondaire (Apple) | **Cartes et navigation** *(Navigation)* |
| Public cible | 18+ *(usage VTC, paiements, transports)* |

---

## 2. Description courte

**App Store — "Promotional text"** (170 caractères, peut être modifié à tout moment sans nouvelle revue) :

```
Commandez une course en français, hassaniya ou arabe — à la voix.
Payez en cash, suivez votre chauffeur sur la carte, et roulez.
```

**Google Play — "Short description"** (80 caractères) :

```
Course en VTC partout en Mauritanie. Commande vocale, paiement cash.
```

---

## 3. Description longue (Google Play + "Description" App Store, 4000 car.)

```
Aloo, c'est l'application de VTC pensée pour la Mauritanie.

POUR LES PASSAGERS
• Commandez une course en quelques secondes — au texte ou à la voix.
• Parlez en français, en hassaniya ou en arabe : on comprend.
• Choisissez vos lieux par nom (« Marché Capitale », « Aéroport Oum Tounsi »…)
  ou en touchant la carte.
• Suivez votre chauffeur en temps réel, et confirmez l'arrivée avec un code à
  4 chiffres.
• Marquez vos chauffeurs préférés et vos trajets habituels pour aller plus vite
  la prochaine fois.

POUR LES CHAUFFEURS
• Recevez les courses proches de vous dès que vous passez en ligne.
• Wallet intégré : suivez votre solde et vos commissions en temps réel.
• Mode « rentre à la maison » : ne recevez plus que des courses sur votre route.
• Heatmap : voyez où sont les passagers en ce moment.
• Acceptez vos courses récurrentes (école, travail) en un appui.

POURQUOI ALOO
• Application 100 % locale, adaptée aux noms de lieux mauritaniens.
• Compréhension vocale multilingue : français, hassaniya, arabe.
• Paiement cash classique — pas de carte bancaire requise.
• Service client par WhatsApp en français et hassaniya.

COMMENT ÇA MARCHE
La création de compte se fait par notre équipe. Contactez-nous sur WhatsApp
au +33 6 56 69 69 74 pour recevoir vos identifiants — généralement sous quelques
minutes. Cette approche nous permet de vérifier chaque utilisateur et de tenir
la communauté à l'écart des comptes frauduleux.

CONFIDENTIALITÉ
Votre numéro de téléphone et votre position ne sont utilisés que pour fournir
le service de course. Voir la politique complète :
https://tewiz-api.radar-mr.com/legal/privacy-policy.html

SUPPORT
WhatsApp : +33 6 56 69 69 74
E-mail   : support@radar-mr.com
Aide     : https://tewiz-api.radar-mr.com/legal/support.html
```

---

## 4. Mots-clés App Store (100 caractères, virgules, sans espace)

```
vtc,taxi,course,mauritanie,nouakchott,chauffeur,trajet,voix,arabe,hassaniya
```

*Évite les mots déjà présents dans le nom et le sous-titre (Apple les indexe automatiquement).*

---

## 5. URLs requises

| Champ | URL |
|---|---|
| Privacy Policy URL *(les deux stores)* | `https://tewiz-api.radar-mr.com/legal/privacy-policy.html` |
| Support URL *(Apple, requis)* | `https://tewiz-api.radar-mr.com/legal/support.html` |
| Marketing URL *(Apple, optionnel)* | *(à remplir si on lance un site marketing)* |
| Adresse e-mail contact reviewer | `support@radar-mr.com` |

---

## 6. Captures d'écran requises

### App Store (iPhone 6.7", 1290 × 2796 px) — min 2, max 10
Recommandé : 5 captures dans cet ordre, chacune avec un texte court superposé.

1. **Écran d'accueil rider** — titre : « Une course en 10 secondes »
2. **Commande vocale** — titre : « Parlez en français, hassaniya, arabe »
3. **Carte avec trajet** — titre : « Suivez votre chauffeur en direct »
4. **Wallet captain** — titre : « Gérez vos gains, payez en cash »
5. **Heatmap captain** — titre : « Trouvez les passagers en un coup d'œil »

### Google Play (téléphone, min 2)
Même set que ci-dessus. Mêmes dimensions acceptées (Google est plus souple).

### Google Play — Feature Graphic (OBLIGATOIRE)
Bandeau **1024 × 500 px**, format JPG ou PNG. Suggéré : logo Aloo centré sur fond beige (#FBF3E7), avec une silhouette de Nouakchott ou un pictogramme de voiture en ember (#F2682C).

---

## 7. Notes pour les reviewers (App Store + Google Play)

Ce texte va dans **App Store Connect → App Review Information → Notes** et **Google Play Console → App content → App access**. Crucial pour éviter le rejet.

```
Bonjour, et merci pour la revue de Aloo.

CE QU'EST L'APPLICATION
Aloo est un service de VTC (transport de personnes) opérant en Mauritanie.
Les passagers commandent une course, un chauffeur l'accepte, et la course est
réglée en espèces à la fin du trajet — exactement comme un taxi traditionnel.

POURQUOI LA CRÉATION DE COMPTE SE FAIT HORS DE L'APP
L'inscription est administrée par notre équipe pour deux raisons :
1. Vérification anti-fraude — la Mauritanie n'a pas d'écosystème SMS fiable,
   nous validons donc chaque numéro via WhatsApp.
2. KYC chauffeur — chaque chauffeur fournit ses papiers d'identité et de
   véhicule avant d'être autorisé à conduire.

Cela signifie qu'un nouvel utilisateur ne peut PAS créer son compte depuis l'app.
Il doit nous contacter sur WhatsApp et nous lui transmettons ses identifiants.
C'est documenté dans l'app (lien « Pas de compte ? » sur l'écran de connexion)
et sur notre page support : https://tewiz-api.radar-mr.com/legal/support.html

COMPTES DE TEST FOURNIS
- Passager :  +22244000001  /  Demo2026!
- Chauffeur : +22244000002  /  Demo2026!  (KYC déjà validé, véhicule actif)

Le compte chauffeur a accès au mode « Captain » (bouton en haut à droite de
l'accueil), au wallet, à la heatmap, et peut accepter des courses.

PAIEMENT — PAS D'IN-APP PURCHASE
Les courses sont des services réels du monde physique (transport de personnes),
explicitement exemptés de l'obligation d'IAP par App Store Review Guideline
3.1.5(a) et la politique de paiement Google Play. Les chauffeurs sont payés en
espèces à la fin de la course, hors de l'application.

Le rechargement du portefeuille chauffeur (top-up wallet) se fait également
en dehors de l'application : le chauffeur envoie une capture du virement à
notre équipe via l'app, et nous créditons son solde manuellement.

SUPPRESSION DE COMPTE
Disponible dans l'app : écran « Compte » (icône en haut à droite de l'accueil) →
bouton « Supprimer mon compte ». Conforme à App Store Guideline 5.1.1(v) et à
la politique Google Play.

CONTACT REVIEWER
Pour toute question pendant la revue :
- E-mail : support@radar-mr.com
- WhatsApp : +33 6 56 69 69 74 (réponse rapide en français)

Merci !
```

---

## 8. Privacy Nutrition Labels (Apple) / Data Safety (Google)

À déclarer dans les deux consoles. Voici la liste **complète** des données collectées :

| Catégorie | Donnée | Pourquoi | Lié à l'utilisateur ? | Utilisé pour tracking ? |
|---|---|---|---|---|
| Identifiants | Numéro de téléphone | Authentification, contact chauffeur ↔ passager | Oui | Non |
| Identifiants | ID utilisateur interne | Authentification | Oui | Non |
| Identifiants | Device ID *(IDFV iOS / ANDROID_ID)* | Dédoublonnage des tokens push | Oui | Non |
| Localisation | Position GPS précise | Trouver chauffeurs proches, calculer trajet | Oui | Non |
| Contenu utilisateur | Photos *(documents KYC chauffeur uniquement)* | Vérification d'identité chauffeur | Oui | Non |
| Contenu utilisateur | Enregistrement audio *(commande vocale)* | Transcription vers texte (Whisper OpenAI), puis supprimé | Non *(non stocké)* | Non |
| Diagnostics | Logs de crash | Stabilité de l'app | Oui *(via Sentry)* | Non |
| Diagnostics | Logs d'utilisation *(API logs)* | Diagnostic, sécurité | Oui | Non |
| Informations financières | Aucune | — | — | — |
| Historique d'achats | Aucune *(paiements externes)* | — | — | — |

**Tiers à déclarer** (sous-traitants techniques) :
- **OpenAI** — transcription audio (Whisper). Audio supprimé après transcription.
- **Anthropic** — extraction de lieu depuis le texte transcrit.
- **Google Maps Platform** — geocoding et cartes.
- **Sentry** — reporting de crashes (région UE).
- **Expo Push Notifications** — relai des notifications push (APNs / FCM).

---

## 9. Classification d'âge

Réponses au questionnaire IARC (Google) et App Store Connect (Apple) :

| Question | Réponse |
|---|---|
| Violence | Non |
| Contenu sexuel | Non |
| Vulgarité | Non |
| Drogues / alcool | Non |
| Jeux d'argent | Non |
| Échange d'informations utilisateur | Oui *(localisation pour le service de course)* |
| Achats numériques | Non |
| Utilisation partagée d'informations | Non |
| Localisation partagée avec autres utilisateurs | Oui *(le chauffeur voit la position du passager, et vice versa, pendant la course)* |

Note résultante attendue : **4+** sur App Store, **PEGI 3 / Everyone** sur Play.

---

## 10. Export Compliance (Apple)

Champ `ITSAppUsesNonExemptEncryption` = `false` dans `Info.plist` ✓ *(déjà configuré dans `app.config.ts`)*.

L'app utilise uniquement HTTPS standard pour communiquer avec son backend — exemption « exempt » sous Bureau of Industry and Security (BIS).

---

## 11. Checklist pré-soumission

À cocher avant de cliquer « Submit for Review » :

- [ ] Build EAS production réussi (iOS .ipa + Android .aab)
- [ ] `pnpm --filter @tewiz/api seed:store-test` exécuté en production
- [ ] Test manuel : login avec `+22244000001` / `Demo2026!` → ride request → confirm
- [ ] Test manuel : login avec `+22244000002` / `Demo2026!` → toggle captain mode → online
- [ ] Test manuel : écran Compte → Supprimer mon compte → fonctionne
- [ ] Privacy policy accessible : `curl -I https://tewiz-api.radar-mr.com/legal/privacy-policy.html` → 200
- [ ] Support page accessible : `curl -I https://tewiz-api.radar-mr.com/legal/support.html` → 200
- [ ] Sentry DSN configuré et crash test reçu sur le dashboard
- [ ] 5 captures App Store (1290×2796 iPhone 6.7")
- [ ] 2+ captures Google Play téléphone
- [ ] Feature graphic Google Play (1024×500)
- [ ] Reviewer notes copiées dans les deux consoles
- [ ] Privacy Labels / Data Safety remplis dans les deux consoles
- [ ] Classification d'âge soumise dans les deux consoles

# Conditions Commission et Bonus - Tewiz Rides
**Version opérationnelle interne | En vigueur à partir de 01/07/2026**

---

## 1. COMMISSION PLATEFORME

### Commission fixe
- **Taux**: 8% sur le prix final du trajet TTC
- **Applicable à**: TOUS les chauffeurs (pas d'exceptions individuelles)
- **Calcul**: Commission = Prix final × 0.08
- **Exemple**: 290 MRU trajet → 23.2 MRU commission → 266.8 MRU payout chauffeur

### Prix minimum garanti
- **Minimum client**: 100 MRU
- **Minimum payout**: chauffeur reçoit min 92 MRU (100 × 92%)

### Frais non-commissionés
Les bonus, frais d'attente, et frais d'annulation sont exclus de la base commission.

---

## 2. BONUS HEBDOMADAIRE - VOLUME

Calculé chaque lundi matin sur les trajets de la semaine précédente (lun-dim).

| Trajets complétés | Bonus |
|------------------|-------|
| 0-39 | 0 MRU |
| 40-69 | 300 MRU |
| 70-99 | 700 MRU |
| 100+ | 1,200 MRU |

### Conditions d'éligibilité
- Taux d'annulation < 5% durant la semaine
- Pas de signalements fraude
- Au moins 1 trajet/jour (minimum 5 trajets pour accéder au bonus)

### Calcul
- Comptage strict: 1 trajet = 1 déplacement payé complété
- Annulations par chauffeur = non comptabilisées
- Trajets avec litiges = en attente de résolution (pris en compte après confirmation)

---

## 3. BONUS DISPONIBILITÉ - HEURES CRITIQUES

Paiement hebdomadaire, chaque lundi.

### Créneaux activés
| Créneau | Horaires | Prime/créneau |
|---------|----------|---------------|
| Matin rush | 7h-9h | 120 MRU |
| Soir rush | 17h-20h | 120 MRU |

### Conditions pour débloquer
- Chauffeur doit être actif au moins 50% du créneau (ex: 60 min sur 120 min pour le matin)
- Minimum 3 trajets complétés durant le créneau
- Taux d'annulation ≤ 10% ce créneau

### Budget cap
- Max 2 créneaux/jour
- Max +2,400 MRU/mois par chauffeur (si tous les jours couverts)

### Réinitialisation
- Bonus reset chaque semaine (lundi)
- Chauffeur doit se réincrire pour la semaine suivante

---

## 4. BONUS FIDÉLITÉ - LONG TERME

Calculé mensuellement, paiement intégré au virement mensuel supplémentaire.

| Mois actifs consécutifs | Bonus mensuel | Condition |
|-------------------------|---------------|-----------|
| 1-2 mois | 0 MRU | Setup initial |
| 3 mois | 500 MRU | Minimum 50 trajets/mois |
| 6 mois | 1,000 MRU | Minimum 50 trajets/mois |
| 12 mois | 2,000 MRU | Minimum 50 trajets/mois |

### Rupture de continuité
- Interruption d'une semaine = continuité conservée
- Interruption de 2+ semaines consécutives = compteur reset à 0
- Démonstration: 3 mois actifs = au mois 4, vous recommencez à 0 si vous arrêtez

### Application
- Bonus versé le 1er du mois suivant
- Droit acquis = appliqué au paiement même si le chauffeur démissionne en fin de mois

---

## 5. BONUS PARRAINAGE

Promotion interne pour croissance chauffeurs.

### Prime versée
- **Par parrain**: 500 MRU
- **Par filleul**: 500 MRU
- **Maximum**: 5 filleuls/mois = +2,500 MRU/mois (parrain) + 500 MRU (filleul)

### Conditions d'éligibilité filleul
- Filleul doit compléter **minimum 60 trajets** dans ses 2 premiers mois
- Prime versée au parrain après validation (semaine 8)
- Prime versée au filleul après validation

### Suivi
- Lien parrainage enregistré dans l'app (code unique fourni au parrain)
- Historique conservé 12 mois
- Appel à fraude possible = annulation des primes

---

## 6. CONDITIONS ANTI-FRAUDE

### Critères de suspension bonus temporaire
- **Taux annulation**: > 10% une semaine → audit + suspension 1 semaine
- **Geolocalisation**: trajets non logiques (vitesse impossible) → suspension immédiate
- **Comportement**: signalement rider non résolu → suspension 1 semaine
- **Documentation**: faux documents → suspension permanente

### Process
1. Détection automatique via système
2. Avertissement + 48h pour répondre
3. Si non-résolution: suspension 1 semaine (bonus/commissions freezes)
4. Réactivation après vérification

### Cas graves (fraude confirmée)
- Trajets fictifs → rembourse la plateforme + suspension
- Collusion rider-chauffeur → perte des 3 derniers mois de commissions
- Faux documents → compte supprimé

---

## 7. PAIEMENT ET VIREMENT

### Calendrier
- **Paiement hebdomadaire**: chaque lundi à 9h (commission + bonus volume)
- **Paiement mensuel supplémentaire**: 1er du mois (bonus fidélité)
- **Délai virement bancaire**: 24h (T+1)

### Détail du paiement
```
Lundi matin:
Commission semaine: (trajets × prix moyen × 92%) = XX MRU
+ Bonus volume: YY MRU
+ Bonus disponibilité: ZZ MRU
= Total net semaine

1er du mois:
Bonus fidélité (si eligible): AA MRU
```

### Minimum payout
- Paiement minimum/semaine: 0 MRU si 0 trajets
- Frais bancaires: absorbés par Tewiz (gratuit pour chauffeur)

---

## 8. RÉVISION ET AJUSTEMENT

### Révision politique
- Tous les 3 mois (audit rentabilité + satisfaction chauffeurs)
- Changements notifiés 14 jours à l'avance
- Changements ne rétroactivent pas (appliqués à partir du lundi suivant la notification)

### Cas d'ajustement
- Si marge plateforme < 5%: bonus volume baissé (ex: 70+ = 500 MRU au lieu de 700)
- Si offre chauffeurs insuffisante: bonus créneaux augmentés temporairement
- Si fraude détectée: taux bonus global peut baisser 1 mois

---

## 9. TABLEAU SYNTHÈSE REVENUS

### Scenario standard (80 trajets/semaine, prix moyen 150 MRU)
```
Commission brute: 12,000 × 92% = 11,040 MRU
Bonus volume (70+): +700 MRU
Bonus créneaux (8 créneaux): +960 MRU
= TOTAL/SEMAINE: 12,700 MRU
= TOTAL/MOIS (4 semaines): ~50,800 MRU
```

### Scenario conservatif (40 trajets/semaine)
```
Commission brute: 6,000 × 92% = 5,520 MRU
Bonus volume: 0 MRU (< 40 trajets)
Bonus créneaux: +240 MRU
= TOTAL/SEMAINE: 5,760 MRU
= TOTAL/MOIS: ~23,040 MRU
```

### Scenario actif (100+ trajets/semaine)
```
Commission brute: 15,000 × 92% = 13,800 MRU
Bonus volume (100+): +1,200 MRU
Bonus créneaux (10 créneaux): +1,200 MRU
Bonus fidélité (6 mois): +250 MRU/semaine
= TOTAL/SEMAINE: 16,450 MRU
= TOTAL/MOIS: ~65,800 MRU
```

---

## 10. SIGNATURE & ACCEPTATION

Cette politique lie Tewiz Rides et le chauffeur.

**Chauffeur accepte en cochant** ✓ lors de l'onboarding.

**Tewiz Rides s'engage à**:
- Paiement à l'heure (chaque lundi)
- Transparence totale (dashboard en temps réel)
- Pas de commission cachée
- Révision trimestrielle juste

**Chauffeur s'engage à**:
- Respecter les conditions anti-fraude
- Comportement professionnel
- Maintenance du véhicule
- Respect des trajets acceptés

---

**Tewiz Rides | Nouakchott | Juin 2026**

Dernière mise à jour: 30 juin 2026
Prochaine révision: 30 septembre 2026

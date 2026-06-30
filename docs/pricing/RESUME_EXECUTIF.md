# 📋 RÉSUMÉ EXÉCUTIF - Stratégie Tarifaire & Bonus

## En une page: ce qui te rend meilleur que la concurrence

### RIDERS (Clients)
| Aspect | Nous | Concurrent A | Concurrent B |
|--------|------|-------------|-------------|
| Ref: 12km/33min | **290 MRU** | 300 MRU | 285 MRU |
| Commission | 8% | 15% | 10% |
| Chauffeur reçoit | 266.8 MRU | 255 MRU | 256.5 MRU |
| Offre | Prix transparent | Surge possible | Limité |

✅ **Nous**: Prix compétitif + Chauffeurs mieux payés = meilleur service

---

### CHAUFFEURS
| Aspect | Nous | Concurrent A | Concurrent B |
|--------|------|-------------|-------------|
| Commission de base | **8%** | 15% | 10% |
| Bonus volume | OUI (+1,200 MRU) | NON | Limité |
| Bonus fidélité | OUI (+2,000 MRU) | NON | NON |
| Bonus créneaux | OUI (+2,400 MRU/mois) | NON | NON |
| Total possible (scenario actif) | **65,800 MRU/mois** | ~45,000 | ~40,000 |

✅ **Nous**: Commission juste + Bonus motivants + Revenus prévisibles

---

## Formule tarifaire client (riders)

```
Prix = max(100 MRU, prise en charge + 20×km + 1×min + 5)
Arrondi au 5 MRU supérieur
```

**Exemples**:
- 2 km, 8 min → 100 MRU (minimum)
- 6 km, 15 min → 150 MRU
- 12 km, 33 min → 290 MRU
- 20 km, 45 min → 455 MRU

---

## Rémunération chauffeur

### Commission fixe
- **8% pour tous** (pas de variation secrète)
- Exemple: 290 MRU trajet → 266.8 MRU payout

### Bonus sans plafond
| Bonus | Condition | Montant |
|-------|-----------|---------|
| **Volume** | 40+ trajets/semaine | +300 à +1,200 MRU |
| **Fidélité** | 3+ mois actifs | +500 à +2,000 MRU/mois |
| **Créneaux** | Heures rush 7-9h, 17-20h | +120 MRU/créneau |
| **Parrainage** | 60 trajets filleul | +500 MRU |

### Budget total chauffeur (4 scénarios)
- Faible (40 trajets/semaine): 23,040 MRU/mois
- Moyen (80 trajets/semaine): 50,800 MRU/mois
- Actif (100+ trajets/semaine): 65,800 MRU/mois
- **Moyenne attendue**: 45,000-55,000 MRU/mois (très compétitif Nouakchott)

---

## Avantage concurrentiel pour toi

### Riders choisissent Tewiz car:
1. Prix transparent (estimé avant)
2. Prix souvent < concurrent A
3. Chauffeurs motivés = service rapide

### Chauffeurs choisissent Tewiz car:
1. Commission simple et juste (8%, tous pareil)
2. Bonus généreux (volume, fidélité, créneaux)
3. Paiement rapide (lundi)
4. Transparence totale (dashboard)

### Plateforme rentable car:
1. Commission 8% = marge acceptable
2. Bonus sur volume = croissance organique
3. Anti-fraude stricte = contrôle coûts
4. Pricing minimum 100 MRU = PLU rationnel

---

## Où trouver les fichiers

```
/docs/pricing/
├── TARIFICATION_RIDERS.md           (affiche dans l'app riders)
├── REMUNERATION_CHAUFFEURS.md       (affiche dans l'app chauffeurs)
└── CONDITIONS_COMMISSION_BONUS.md   (contrat officiel interne)
```

---

## Checklist implémentation

- [ ] Ajouter TARIFICATION_RIDERS.md à l'écran "Tarifs" de l'app rider
- [ ] Ajouter REMUNERATION_CHAUFFEURS.md à la page "Gagner avec nous"
- [ ] Signer CONDITIONS_COMMISSION_BONUS.md avec les chauffeurs (onboarding)
- [ ] Dashboard chauffeur affiche "Gains" en temps réel (commission + bonus)
- [ ] Dashboard rider affiche l'estimation avec détail du prix
- [ ] Paiement automatisé lundi matin (API bancaire)
- [ ] Audit fraude automatisé (annulations, geoloc, trajets fictifs)

---

## Communication d'lancement (marketing)

**Tagline riders**: "Tarif juste, prix clair, pas de surprise"
**Tagline chauffeurs**: "8% de commission + bonus motivants, c'est rentable"
**Tagline brand**: "Tewiz: équilibre client-chauffeur, service durable"

---

**Créé**: 30 juin 2026  
**Statut**: Prêt à lancer  
**Mise à jour suivante**: 30 septembre 2026 (révision trimestrielle)

# ads/ — générateur d'annonces Aloo

**Avant toute chose : lire `ads/PASSATION.md`.**

Il contient l'état d'avancement, l'architecture, les pièges déjà payés, et les
vérifications à relancer après chaque changement. Ne pas redécouvrir seul ce
qui y est écrit.

## Rappels courts

```bash
cd ads
.venv/bin/python build.py    # posters.json -> HTML
./render.sh                  # HTML -> PNG
```

- **`posters.json` est le seul fichier à éditer** pour un texte, une photo ou
  un gabarit. Le Python n'a pas à être ouvert pour ça.
- **Vérifier que le serveur local répond** avant une série de rendus :
  `curl -sf http://localhost:4399/` — s'il est tombé, Chrome photographie une
  page d'erreur et toutes les mesures deviennent fausses.
- **Rendre par lot, puis mesurer par script.** Ne regarder que les PNG que la
  mesure signale. Ouvrir chaque image une par une coûte cher pour rien.
- **`assets/_sources/` contient les originaux non teintés — ne jamais les
  supprimer.** Toute re-teinte repart de là.
- Une photo se juge **en 2160 px**, jamais sur une vignette.

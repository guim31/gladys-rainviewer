# RainViewer

## Ce que fait l’intégration

La mosaïque mondiale des radars de pluie de [RainViewer](https://www.rainviewer.com) dans Gladys, sans compte ni clé d’API. Chaque lieu devient un appareil :

- **Radar de pluie** : une image caméra du radar centrée sur le lieu, sur une carte OpenStreetMap, renouvelée à chaque image radar (toutes les 10 minutes) ;
- **Pluie** : s’il pleut sur le lieu en ce moment (1 = pluie) ;
- **Intensité de pluie** : son intensité approximative, en mm/h ;
- **Pluie la plus proche** : la distance de la pluie la plus proche, en km (0 quand il pleut sur le lieu, 50 quand aucune pluie ne tombe à moins de 50 km) ;
- **Heure du radar** : l’heure de l’image radar.

Elle complète les intégrations de radar nationales (Buienradar pour les Pays-Bas et la Belgique, DWD pour l’Allemagne) par une source mondiale.

## Prérequis

- Gladys Assistant 5.1.0 ou plus récent.
- Une connexion Internet : le radar vient des serveurs de RainViewer.
- Au moins un lieu : une maison de Gladys située (Paramètres → Maisons), ou un « Autre lieu » de la configuration.

## Installation

1. Dans Gladys, ouvrez **Intégrations → Installer depuis GitHub** et saisissez `https://github.com/guim31/gladys-rainviewer`.
2. Acceptez l’accès à la position de vos maisons : il donne son radar à chaque maison.
3. Ouvrez l’onglet **Découverte** et ajoutez les lieux voulus.

## Configuration

- **Langue des noms de fonctionnalités** : anglais, français, allemand ou espagnol (français par défaut). Utilisée à l’ajout d’un appareil, et pour l’heure du radar.
- **Étendue de l’image radar** : Région (environ 500 km, par défaut), Pays (environ 1 000 km) ou Continent (environ 2 000 km). Les valeurs de pluie sont toujours lues à l’échelle la plus fine.
- **Distance « Pluie en approche » (km)** : de 2 à 50 km, 15 par défaut.
- **Autres lieux** : facultatif, `Nom : latitude, longitude` séparés par des points-virgules, par exemple `Bureau : 48.8566, 2.3522 ; Chalet : 45.92, 6.87`. Renommer un lieu crée un nouvel appareil. Huit lieux au plus, maisons comprises.

Le bouton **Vérifier le radar** lit la dernière image radar maintenant et dit, pour chaque lieu, s’il pleut.

## Appareils

Les valeurs sont lues sur la dernière image radar, à l’échelle la plus fine de l’API publique (environ 1 km par pixel en Europe) :

- il pleut sur le lieu quand le radar voit au moins 15 dBZ à environ 1 km autour (en dessous, les échos faibles sont au plus de la bruine, souvent des échos de sol) ;
- l’intensité est déduite de la réflectivité par la relation de Marshall-Palmer : une approximation, souvent à un facteur deux près, suffisante pour distinguer la bruine de l’averse ;
- la pluie la plus proche est cherchée dans un rayon de 50 km.

Hors de la couverture radar (océans, une grande partie de l’Afrique et de l’Asie), l’appareil ne montre que l’heure du radar, et l’intégration le signale dans son journal.

## Widget du tableau de bord

**Radar de pluie** : l’image radar d’un lieu, la pluie qui y tombe et la pluie la plus proche, avec l’heure de l’image radar. Le réglage **Afficher l’image radar** masque l’image, pour une petite tuile. La caméra de chaque lieu fonctionne aussi dans la boîte caméra de Gladys, et avec l’action de scène « Envoyer une image de caméra ».

## Scènes

Déclencheurs :

- **RainViewer : pluie en approche** : la pluie du radar arrive à la distance configurée d’un lieu où il ne pleut pas encore. Une fois par approche, jamais au démarrage. Variables : lieu, distance (km).
- **RainViewer : fin de la pluie** : le radar ne montre plus de pluie sur un lieu depuis 20 minutes, après un épisode pluvieux. Variables : lieu, durée de la pluie (min).

Laissez le lieu vide pour tous les lieux. La pluie qui commence, c’est la fonctionnalité **Pluie** qui passe à 1, une condition d’appareil classique.

Action :

- **RainViewer : lire la pluie** : lit la dernière image radar d’un lieu : il pleut, intensité (mm/h), pluie la plus proche (km), heure du radar, pour une condition ou un message. Elle échoue (en rouge) hors de la couverture radar.

## Limites

- L’API publique de RainViewer ne sert que les deux dernières heures de radar : pas d’images de prévision (nowcast), l’intégration surveille donc la distance de la pluie plutôt que de la prédire.
- Zoom 7 au plus et un seul jeu de couleurs (Universal Blue), comme le permet l’API publique.
- Un radar voit la pluie, pas toujours la neige ; quelques échos ne sont pas de la pluie (échos de sol, éoliennes).
- RainViewer ne garantit pas sa disponibilité : quand il ne répond plus pendant 30 minutes, l’intégration le signale dans Gladys et reprend d’elle-même.

## Comment elle a été testée

Testée contre la vraie API de RainViewer : lieux sous la pluie, au sec, près de la pluie et hors couverture radar, coupure réseau, et images radar vérifiées à l’œil. Les tests rejouent de vraies tuiles radar. Pas encore testée dans un vrai Gladys : vos retours sont les bienvenus sur [GitHub](https://github.com/guim31/gladys-rainviewer/issues).

## Crédits et conditions

Données radar de [RainViewer](https://www.rainviewer.com), dont l’API gratuite est réservée à un usage personnel et éducatif ; la mention « RainViewer » est écrite sur chaque image et dans le widget. Carte © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) ; les tuiles de carte sont gardées 30 jours en cache, comme le demande la politique d’usage d’OSM. Cette intégration n’est pas affiliée à RainViewer.

## Assistance

Questions et bugs : [tickets GitHub](https://github.com/guim31/gladys-rainviewer/issues).

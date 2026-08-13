# Free Codex

> [English](README.en.md) | [中文](README.md) | Français

Free Codex est un environnement de développement IA basé sur Electron. Il combine l'expérience officielle de ChatGPT avec une passerelle locale `codex-mcp`, permettant à ChatGPT d'utiliser des outils MCP pour interagir avec les projets locaux.

## Introduction

Free Codex fournit un environnement de développement de bureau similaire à un IDE IA, avec la gestion de projets locaux, la manipulation de fichiers, un système de compétences, l'exécution d'outils et l'assistance IA pour la modification du code.

## Fonctionnalités

### Intégration de ChatGPT Desktop

- Construit avec Electron + Vue 3
- Intègre l'interface web de ChatGPT via Electron `WebContentsView`
- Offre une expérience ChatGPT adaptée au bureau
- Synchronise les thèmes et le contexte des projets

### Passerelle MCP locale

Intègre `codex-mcp` comme passerelle d'exécution IA locale :

- Gestion des services MCP
- Fourniture d'outils locaux à ChatGPT
- Gestion de la configuration MCP
- Prise en charge des workflows d'agents IA

### Espace de travail projet

Prend en charge :

- Sélection et changement de répertoire projet
- Exploration des fichiers du projet
- Injection du contexte du projet
- Référence de fichiers avec `@`

Exemple :

```text
@src/main/index.ts
```

### Système de compétences

Prend en charge un mécanisme de compétences similaire aux assistants de programmation IA :

```text
/skill:refactor
```

Permet de définir des workflows IA réutilisables.

### Gestion des modifications de fichiers

Prend en charge :

- Visualisation des différences (Diff)
- Vérification des modifications IA
- Validation des changements
- Annulation des modifications

### Système de fenêtre flottante

Grâce à une fenêtre Overlay indépendante :

- Palette de commandes
- Visualiseur Diff
- Notifications
- Sélecteur de fichiers

## Technologies

- Electron
- Vue 3
- TypeScript
- Vite
- Tailwind CSS
- shadcn-vue
- MCP
- codex-mcp

## Structure du projet

```text
free-codex/
├── src/
│   ├── main/              # Processus principal Electron
│   ├── preload/           # Couche de communication
│   ├── renderer/          # Interface frontend
│   └── renderer-overlay/  # Interface flottante
├── docs/
├── dist/
├── release/
└── package.json
```

## Développement

Installer les dépendances :

```bash
npm install
```

Démarrer le projet :

```bash
npm run dev
```

Vérification des types :

```bash
npm run typecheck
```

Construction :

```bash
npm run dist
```

## Configuration

Les configurations suivantes sont disponibles :

- Services MCP
- Répertoire du projet
- Paramètres proxy
- Cloudflare Tunnel
- Préférences UI
- Démarrage automatique

## Architecture

```text
ChatGPT
   |
 Protocole MCP
   |
Passerelle codex-mcp
   |
Application desktop Free Codex
   |
Espace de travail local
```

## Roadmap

- Intégration de l'éditeur Monaco
- Terminal intégré
- Gestionnaire de fichiers
- Planification d'objectifs Agent
- Édition multi-fichiers
- Indexation de projet et recherche sémantique
- Expérience de programmation IA similaire à Cursor

## Licence

Le projet est actuellement en phase de développement.

import { HEALTH_CHECK_ORDER, HEALTH_DISK_ALERT_BYTES, type HealthFacts, type HealthItem, type HealthReport } from './types.js';

const COUNT_WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'] as const;

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

function item(partial: HealthItem): HealthItem {
  return partial;
}

function phraseFacts(facts: HealthFacts): HealthItem[] {
  const items: HealthItem[] = [];

  if (facts.ollama !== 'skip') {
    if (facts.ollama === 'timeout') {
      items.push(item({ id: 'ollama', level: 'orange', sentence: "Je n'ai pas pu joindre Ollama à temps.", short: 'Ollama', open: 'model' }));
    } else if (!facts.ollama.reachable) {
      items.push(item({ id: 'ollama', level: 'red', sentence: 'Ollama ne répond pas : les modèles de ce PC sont injoignables.', short: 'Ollama', open: 'model' }));
    } else {
      items.push(item({ id: 'ollama', level: 'green', sentence: 'Ollama répond.', short: 'Ollama', open: 'model' }));
    }
  }

  if (facts.models !== 'skip') {
    if (facts.models === 'timeout') {
      items.push(item({ id: 'models', level: 'orange', sentence: "Je n'ai pas pu vérifier les modèles à temps.", short: 'les modèles', open: 'model' }));
    } else if (facts.models.missing.length === 0) {
      items.push(item({ id: 'models', level: 'green', sentence: 'Les modèles réglés sont installés.', short: 'les modèles', open: 'model' }));
    } else {
      for (const missing of facts.models.missing) {
        items.push(
          item({
            id: 'models',
            level: 'red',
            sentence: `Le modèle ${missing.name} n'est plus installé : ${missing.role} ne peut pas répondre.`,
            short: `le modèle ${missing.name}`,
            open: missing.open,
          }),
        );
      }
    }
  }

  if (facts.voice !== 'skip') {
    if (facts.voice === 'timeout') {
      items.push(item({ id: 'voice', level: 'orange', sentence: "Je n'ai pas pu vérifier les fichiers de voix à temps.", short: 'la voix', open: 'voice.enabled' }));
    } else if (facts.voice.missing > 0) {
      items.push(item({ id: 'voice', level: 'red', sentence: `Il manque ${facts.voice.missing} fichier${facts.voice.missing > 1 ? 's' : ''} de voix.`, short: 'la voix', open: 'voice.enabled' }));
    } else {
      items.push(item({ id: 'voice', level: 'green', sentence: 'Les fichiers de voix sont là.', short: 'la voix', open: 'voice.enabled' }));
    }
  }

  if (facts.piper !== 'skip') {
    if (facts.piper === 'timeout') {
      items.push(item({ id: 'piper', level: 'orange', sentence: "Je n'ai pas pu vérifier Piper à temps.", short: 'Piper', open: 'voice.ttsProvider' }));
    } else if (!facts.piper.ready) {
      items.push(item({ id: 'piper', level: 'red', sentence: "La voix Piper n'est pas prête.", short: 'Piper', open: 'voice.ttsProvider' }));
    } else {
      items.push(item({ id: 'piper', level: 'green', sentence: 'Piper est prêt.', short: 'Piper', open: 'voice.ttsProvider' }));
    }
  }

  if (facts.spotify !== 'skip') {
    if (facts.spotify === 'timeout') {
      items.push(item({ id: 'spotify', level: 'orange', sentence: "Je n'ai pas pu vérifier Spotify à temps.", short: 'Spotify', open: 'spotifyClientId' }));
    } else if (!facts.spotify.tokenOk) {
      items.push(item({ id: 'spotify', level: 'red', sentence: "Spotify n'est plus connecté. Reconnecte-le.", short: 'Spotify', open: 'spotifyClientId' }));
    } else if (facts.spotify.speakerName && facts.spotify.speakerVisible === false) {
      items.push(item({ id: 'spotify', level: 'orange', sentence: `L'enceinte « ${facts.spotify.speakerName} » n'est pas visible.`, short: "l'enceinte Spotify", open: 'spotifyDeviceName' }));
    } else {
      items.push(item({ id: 'spotify', level: 'green', sentence: 'Spotify est connecté.', short: 'Spotify', open: 'spotifyClientId' }));
    }
  }

  if (facts.google !== 'skip') {
    if (facts.google === 'timeout') {
      items.push(item({ id: 'google', level: 'orange', sentence: "Je n'ai pas pu vérifier Google à temps.", short: 'Google', open: 'googleClientId' }));
    } else if (facts.google.needsReconsent || !facts.google.connected) {
      items.push(item({ id: 'google', level: 'orange', sentence: 'Google demande une nouvelle connexion.', short: 'Google', open: 'action.google.connect' }));
    } else {
      items.push(item({ id: 'google', level: 'green', sentence: 'Google est connecté.', short: 'Google', open: 'googleClientId' }));
    }
  }

  if (facts.phone !== 'skip') {
    if (facts.phone === 'timeout') {
      items.push(item({ id: 'phone', level: 'orange', sentence: "Je n'ai pas pu vérifier le téléphone à temps.", short: 'le téléphone', open: 'state.phone' }));
    } else if (!facts.phone.published) {
      items.push(item({ id: 'phone', level: 'orange', sentence: "Le téléphone n'est pas publié sur Tailscale.", short: 'le téléphone', open: 'state.phone' }));
    } else {
      items.push(item({ id: 'phone', level: 'green', sentence: 'Le téléphone est publié.', short: 'le téléphone', open: 'state.phone' }));
    }
  }

  if (facts.speakers !== 'skip') {
    if (facts.speakers === 'timeout') {
      items.push(item({ id: 'speakers', level: 'orange', sentence: "Je n'ai pas pu vérifier les enceintes à temps.", short: 'les enceintes', open: 'state.speakers' }));
    } else if (!facts.speakers.heard) {
      items.push(item({ id: 'speakers', level: 'orange', sentence: "Aucune phrase n'est encore arrivée des enceintes.", short: 'les enceintes', open: 'state.speakers' }));
    } else {
      items.push(item({ id: 'speakers', level: 'green', sentence: 'Les enceintes ont déjà parlé.', short: 'les enceintes', open: 'state.speakers' }));
    }
  }

  if (facts.robot !== 'skip') {
    if (facts.robot === 'timeout') {
      items.push(item({ id: 'robot', level: 'orange', sentence: "Je n'ai pas pu joindre le robot à temps.", short: 'le robot', open: 'roverBaseUrl' }));
    } else if (!facts.robot.reachable) {
      items.push(item({ id: 'robot', level: 'red', sentence: 'Le robot ne répond pas.', short: 'le robot', open: 'roverBaseUrl' }));
    } else {
      items.push(item({ id: 'robot', level: 'green', sentence: 'Le robot répond.', short: 'le robot', open: 'roverBaseUrl' }));
    }
  }

  if (facts.printer !== 'skip') {
    if (facts.printer === 'timeout') {
      items.push(item({ id: 'printer', level: 'orange', sentence: "Je n'ai pas pu joindre l'imprimante à temps.", short: "l'imprimante", open: 'action.health.refresh' }));
    } else if (!facts.printer.reachable) {
      items.push(item({ id: 'printer', level: 'red', sentence: "L'imprimante ne répond pas.", short: "l'imprimante", open: 'action.health.refresh' }));
    } else {
      items.push(item({ id: 'printer', level: 'green', sentence: "L'imprimante répond.", short: "l'imprimante", open: 'action.health.refresh' }));
    }
  }

  if (facts.disk !== 'skip') {
    if (facts.disk === 'timeout') {
      items.push(item({ id: 'disk', level: 'orange', sentence: "Je n'ai pas pu mesurer la place sur le disque.", short: 'le disque', open: 'machine.profile' }));
    } else if (facts.disk.freeBytes < HEALTH_DISK_ALERT_BYTES) {
      items.push(item({ id: 'disk', level: 'orange', sentence: 'Il reste moins de 10 Go sur le disque.', short: 'le disque', open: 'machine.profile' }));
    } else {
      items.push(item({ id: 'disk', level: 'green', sentence: 'Il y a assez de place sur le disque.', short: 'le disque', open: 'machine.profile' }));
    }
  }

  if (facts.backup !== 'skip' && facts.backup !== 'timeout' && facts.backup.configured) {
    if (!facts.backup.ok) {
      items.push(item({ id: 'backup', level: 'red', sentence: 'La dernière sauvegarde a échoué. Les empreintes ne correspondent pas.', short: 'la sauvegarde', open: 'backup.directory' }));
    } else if (facts.backup.lastAt === null) {
      items.push(item({ id: 'backup', level: 'orange', sentence: "Aucune sauvegarde n'a encore été faite.", short: 'la sauvegarde', open: 'backup.directory' }));
    } else if (facts.backup.stale) {
      items.push(item({ id: 'backup', level: 'orange', sentence: 'La dernière sauvegarde est trop ancienne.', short: 'la sauvegarde', open: 'backup.directory' }));
    } else {
      items.push(item({ id: 'backup', level: 'green', sentence: 'La dernière sauvegarde est récente.', short: 'la sauvegarde', open: 'backup.directory' }));
    }
  } else if (facts.backup === 'timeout') {
    items.push(item({ id: 'backup', level: 'orange', sentence: "Je n'ai pas pu vérifier la sauvegarde à temps.", short: 'la sauvegarde', open: 'backup.directory' }));
  }

  if (facts.vault !== 'skip') {
    if (facts.vault === 'timeout') {
      items.push(item({ id: 'vault', level: 'orange', sentence: "Je n'ai pas pu vérifier le coffre des clés.", short: 'le coffre', open: 'action.health.refresh' }));
    } else if (!facts.vault.encryptionAvailable) {
      items.push(item({ id: 'vault', level: 'orange', sentence: 'Ce PC ne chiffre pas les clés : elles restent dans les réglages, comme avant.', short: 'le coffre', open: 'apiKey' }));
    } else {
      items.push(item({ id: 'vault', level: 'green', sentence: 'Les clés sont dans le coffre.', short: 'le coffre', open: 'apiKey' }));
    }
  }

  return items;
}

/** Le modèle manquant pointe vers le bon réglage (équipe, cerveau, code…). */
export function withModelOpens(items: HealthItem[], opens: readonly string[]): HealthItem[] {
  let index = 0;
  return items.map((entry) => {
    if (entry.id !== 'models' || entry.level === 'green' || entry.level === 'orange') return entry;
    const open = opens[index] ?? entry.open;
    index += 1;
    return { ...entry, open };
  });
}

export function buildHealthReport(facts: HealthFacts, at = facts.now ?? Date.now()): HealthReport {
  const rank = new Map(HEALTH_CHECK_ORDER.map((id, index) => [id, index]));
  const items = phraseFacts(facts).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const issues = items.filter((entry) => entry.level !== 'green');
  const banner = issues.length === 0 ? null : issues.length === 1 ? '1 chose à régler' : `${issues.length} choses à régler`;
  const text = items.length === 0 ? 'Tout va bien.' : items.map((entry) => entry.sentence).join('\n');
  let voice: string;
  if (issues.length === 0) voice = 'Tout va bien.';
  else if (issues.length === 1) voice = `Un souci : ${issues[0]?.short ?? 'un contrôle'}.`;
  else voice = `${capitalize(countWord(issues.length))} soucis : ${issues.map((entry) => entry.short).join(', ')}.`;
  return { items, issues: issues.length, banner, text, voice, at };
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

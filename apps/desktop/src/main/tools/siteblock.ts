import { z } from 'zod';
import { defineTool, SITEBLOCK_TIME_PATTERN } from '@jarvis/core';
import type { SiteBlockBridge } from '../siteblock/SiteBlockBridge.js';

export interface SiteBlockToolsDeps {
  siteBlock: SiteBlockBridge;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Huit outils SiteBlock. La lecture (`get_status`) est `safe`. Toute
 * modification de règle est `confirm` + `forceConfirm` : même si la
 * catégorie Applications est à « jamais », Jarvis demande avant d’activer
 * ou de couper un blocage.
 */
export function createSiteBlockTools(deps: SiteBlockToolsDeps) {
  const siteblockGetStatus = defineTool({
    name: 'siteblock_get_status',
    description:
      "Donne l'état actuel de SiteBlock : blocage actif, domaines bloqués, périodes, focus et verrouillage.",
    risk: 'safe',
    schema: z.object({}),
    execute: async () => {
      try {
        const status = await deps.siteBlock.status();
        return {
          ok: true,
          content: [
            `Blocage: ${status.blockingActiveNow ? 'actif' : 'inactif'}.`,
            `Sites: ${status.domains.length ? status.domains.join(', ') : 'aucun'}.`,
            `Focus: ${status.focus.active ? `actif jusqu'à ${status.focus.until}` : 'inactif'}.`,
          ].join(' '),
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockSetBlocking = defineTool({
    name: 'siteblock_set_blocking',
    description:
      'Active ou désactive le blocage SiteBlock. Utiliser lorsque l’utilisateur demande de bloquer ou débloquer les sites.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    isDestructive: ({ enabled }) => !enabled,
    schema: z.object({ enabled: z.boolean() }),
    summarize: ({ enabled }) =>
      `${enabled ? 'Activer' : 'Désactiver'} le blocage SiteBlock.`,
    describeCommand: ({ enabled }) => `SiteBlock blocking=${enabled ? 'on' : 'off'}`,
    execute: async ({ enabled }) => {
      try {
        const status = await deps.siteBlock.setBlocking(enabled);
        return {
          ok: true,
          content: `Blocage SiteBlock ${status.blockingActiveNow ? 'actif' : 'désactivé'}.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockAddDomain = defineTool({
    name: 'siteblock_add_domain',
    description:
      'Ajoute un domaine à la liste des sites bloqués. Accepte un domaine ou une URL.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    schema: z.object({ domain: z.string().min(1).max(255) }),
    summarize: ({ domain }) => `Bloquer le site ${domain}.`,
    describeCommand: ({ domain }) => `SiteBlock add ${domain}`,
    execute: async ({ domain }) => {
      try {
        const status = await deps.siteBlock.addDomain(domain);
        return {
          ok: true,
          content: `Site ajouté au blocage : ${domain}.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockRemoveDomain = defineTool({
    name: 'siteblock_remove_domain',
    description: 'Retire un domaine de la liste des sites bloqués.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    isDestructive: true,
    schema: z.object({ domain: z.string().min(1).max(255) }),
    summarize: ({ domain }) => `Autoriser à nouveau ${domain}.`,
    describeCommand: ({ domain }) => `SiteBlock remove ${domain}`,
    execute: async ({ domain }) => {
      try {
        const status = await deps.siteBlock.removeDomain(domain);
        return {
          ok: true,
          content: `Site retiré du blocage : ${domain}.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockStartFocus = defineTool({
    name: 'siteblock_start_focus',
    description:
      'Démarre une session de concentration qui bloque les sites pendant une durée donnée. Des domaines peuvent être ajoutés à la volée. Correspond à « active mon mode travail ».',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    schema: z.object({
      minutes: z.number().int().min(1).max(1440),
      domains: z.array(z.string().min(1).max(255)).max(50).optional(),
    }),
    summarize: ({ minutes, domains }) =>
      `Activer le mode concentration pendant ${minutes} minutes${
        domains?.length ? ` avec ${domains.length} site(s) supplémentaire(s)` : ''
      }.`,
    describeCommand: ({ minutes, domains }) =>
      `SiteBlock focus ${minutes} min${domains?.length ? ` + ${domains.join(', ')}` : ''}`,
    execute: async ({ minutes, domains }) => {
      try {
        const status = await deps.siteBlock.startFocus(minutes, domains);
        return {
          ok: true,
          content: `Mode concentration activé pendant ${minutes} minutes.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockStopFocus = defineTool({
    name: 'siteblock_stop_focus',
    description: 'Arrête la session de concentration SiteBlock en cours.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    isDestructive: true,
    schema: z.object({}),
    summarize: () => 'Arrêter le mode concentration SiteBlock.',
    describeCommand: () => 'SiteBlock focus stop',
    execute: async () => {
      try {
        const status = await deps.siteBlock.stopFocus();
        return {
          ok: true,
          content: 'Mode concentration arrêté.',
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockAddPeriod = defineTool({
    name: 'siteblock_add_period',
    description: 'Crée une période de blocage quotidienne récurrente au format HH:mm.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    schema: z.object({
      name: z.string().min(1).max(80).optional(),
      start: z.string().regex(SITEBLOCK_TIME_PATTERN),
      end: z.string().regex(SITEBLOCK_TIME_PATTERN),
    }),
    summarize: ({ name, start, end }) =>
      `Programmer le blocage ${name ?? 'sans nom'} de ${start} à ${end}.`,
    describeCommand: ({ name, start, end }) =>
      `SiteBlock period ${name ?? 'Jarvis'} ${start}–${end}`,
    execute: async ({ name, start, end }) => {
      try {
        const status = await deps.siteBlock.addPeriod(name ?? 'Jarvis', start, end);
        return {
          ok: true,
          content: `Période SiteBlock créée : ${start} → ${end}.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  const siteblockRemovePeriod = defineTool({
    name: 'siteblock_remove_period',
    description: 'Supprime une période SiteBlock à partir de son identifiant.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    isDestructive: true,
    schema: z.object({ id: z.string().min(1) }),
    summarize: ({ id }) => `Supprimer la période SiteBlock ${id}.`,
    describeCommand: ({ id }) => `SiteBlock period delete ${id}`,
    execute: async ({ id }) => {
      try {
        const status = await deps.siteBlock.removePeriod(id);
        return {
          ok: true,
          content: `Période SiteBlock ${id} supprimée.`,
          data: status,
        };
      } catch (error) {
        return { ok: false, content: `SiteBlock : ${describeError(error)}` };
      }
    },
  });

  return [
    siteblockGetStatus,
    siteblockSetBlocking,
    siteblockAddDomain,
    siteblockRemoveDomain,
    siteblockStartFocus,
    siteblockStopFocus,
    siteblockAddPeriod,
    siteblockRemovePeriod,
  ];
}

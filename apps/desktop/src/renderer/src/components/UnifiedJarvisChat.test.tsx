import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { unifiedChatSubmitTarget } from './unifiedChatSubmit';
import { UnifiedJarvisChat } from './UnifiedJarvisChat';

describe('unifiedChatSubmitTarget (5.0.69)', () => {
  const missionsOn = parseSettings({
    provider: 'ollama',
    orchestra: { enabled: true, brain: 'qwen2.5:7b' },
    developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true, codeModel: 'x' },
  });

  it('réglage missions actif : toujours le chat', () => {
    expect(unifiedChatSubmitTarget('Crée un script avec export G-code', missionsOn)).toBe('chat');
  });

  it('correction réglage coupé : chat pour noteToRecord', () => {
    const missionsOff = parseSettings({
      provider: 'ollama',
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' },
    });
    expect(
      unifiedChatSubmitTarget("Non, c'est faux. Utilise un fichier G-code.", missionsOff),
    ).toBe('chat');
  });
});

describe('UnifiedJarvisChat', () => {
  it('expose la discussion unifiée sans second composer', () => {
    const html = renderToStaticMarkup(
      <UnifiedJarvisChat
        settings={null}
        voice={
          {
            state: 'sleeping',
            level: 0,
            liveTranscript: '',
            mic: { phase: 'open', muted: false, opens: 0, inputs: [], timings: {} },
            micError: null,
            micNotice: null,
            voiceError: null,
            whisperStatus: null,
            speakingText: null,
            stopSpeaking: () => undefined,
            speak: () => undefined,
            noteAssistantReply: () => undefined,
            inVoiceConversation: false,
            endConversation: () => undefined,
            listMicrophones: async () => [],
            retryMicrophone: () => undefined,
          } as never
        }
        onSaved={() => undefined}
        chat={{ items: [], busy: false, confirmation: null, send: vi.fn(), cancel: vi.fn(), respond: vi.fn() }}
        booting={false}
        bootError={null}
      />,
    );
    expect(html).toContain('data-unified-chat');
    expect(html).toContain('composer-wrap');
  });
});

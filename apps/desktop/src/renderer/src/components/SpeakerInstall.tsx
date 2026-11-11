import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';

/**
 * Assistant « Ajouter une enceinte ». Trois écrans, tutoiement, un bouton par problème.
 * Le mot de passe reste dans cette fenêtre : il n'est pas écrit sur le disque.
 */
export interface InstallScreenProps {
  screen: 'branch' | 'wifi' | 'go' | 'error';
  sentence?: string;
  button?: string;
  checks?: Array<{ label: string; state: 'wait' | 'ok' | 'no' }>;
  onNext?: () => void;
  onInstall?: (input: { name: string; ssid: string; pass: string }) => void;
  onRetry?: () => void;
}

export function SpeakerInstallView({ screen, sentence, button, checks, onNext, onInstall, onRetry }: InstallScreenProps) {
  const [name, setName] = useState('Salon');
  const [ssid, setSsid] = useState('');
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);

  if (screen === 'branch') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className="text-sm text-slate-100">Branche ta carte au PC avec le câble USB.</p>
        <p className="text-xs text-slate-400">Prends la prise marquée UART ou COM. Un câble de charge seule ne suffit pas.</p>
        <Button variant="default" onClick={onNext}>
          Elle est branchée
        </Button>
      </div>
    );
  }

  if (screen === 'wifi') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <p className="text-sm text-slate-100">Choisis la pièce et le Wi-Fi que l’enceinte peut voir (2,4 GHz).</p>
        <Input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} aria-label="Pièce" />
        <Input value={ssid} maxLength={32} placeholder="Nom du Wi-Fi" onChange={(event) => setSsid(event.target.value)} aria-label="Wi-Fi" />
        <div className="flex items-center gap-2">
          <Input
            type={show ? 'text' : 'password'}
            value={pass}
            maxLength={63}
            placeholder="Mot de passe"
            onChange={(event) => setPass(event.target.value)}
            aria-label="Mot de passe"
          />
          <Button type="button" size="sm" variant="ghost" onClick={() => setShow((value) => !value)}>
            {show ? 'Cacher' : 'Voir'}
          </Button>
        </div>
        <Button
          variant="default"
          disabled={!name.trim() || !ssid.trim() || (pass.length > 0 && pass.length < 8)}
          onClick={() => onInstall?.({ name: name.trim(), ssid: ssid.trim(), pass })}
        >
          Installer
        </Button>
      </div>
    );
  }

  if (screen === 'error') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3">
        <p className="text-sm text-rose-100">{sentence}</p>
        <Button variant="default" onClick={onRetry}>
          {button ?? 'Réessayer'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-sm text-slate-100">Installation</p>
      <ul className="flex flex-col gap-1 text-sm">
        {(checks ?? []).map((check) => (
          <li key={check.label} className={check.state === 'no' ? 'text-rose-200' : 'text-slate-200'}>
            {check.state === 'ok' ? '✓' : check.state === 'no' ? '×' : '·'} {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function speakerInstallScene(scene: string | null): InstallScreenProps['screen'] | null {
  if (scene === 'speaker-install') return 'branch';
  if (scene === 'speaker-install-error') return 'error';
  if (scene === 'speaker-list' || scene === 'speaker-diagnose') return null;
  return null;
}

import { ArrowUp, Square, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';

interface ComposerProps {
  busy: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}

const MAX_HEIGHT = 140;

export function Composer({ busy, onSend, onCancel }: ComposerProps) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const node = textarea.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    const focus = (): void => textarea.current?.focus();
    focus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);

  const submit = (): void => {
    if (busy || value.trim().length === 0) return;
    onSend(value);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="no-drag composer-wrap">
      <div className="composer-box">
        <Sparkles className="composer-spark" />
        <textarea
          ref={textarea}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Demande quelque chose à Jarvis…"
        />
        <div className="composer-meta">
          <span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span>
          {busy ? <span className="composer-thinking">Jarvis réfléchit…</span> : null}
        </div>
        {busy ? (
          <Button variant="subtle" size="icon" onClick={onCancel} title="Interrompre">
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            onClick={submit}
            disabled={value.trim().length === 0}
            title="Envoyer (Entrée)"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

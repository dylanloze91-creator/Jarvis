import { useEffect, useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

/**
 * 5.0.64 — bouton à deux temps pour une action irréversible de l'interface
 * (« Tout effacer », « Vider le journal ») : le premier clic demande « Sûr ? »,
 * le second exécute ; sans réponse dans les 5 s, le bouton revient à l'état
 * de départ. Rien ne passe par un `window.confirm` (fenêtre native, hors du
 * style de Jarvis et bloquante pour la voix).
 */
export function ConfirmButton({
  label,
  confirmLabel = 'Sûr ? Confirmer',
  onConfirm,
  variant = 'ghost',
  size = 'sm',
  ...rest
}: Omit<ButtonProps, 'onClick' | 'children'> & {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <Button size={size} variant={variant} onClick={() => setArmed(true)} {...rest}>
        {label}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Button
        size={size}
        variant="danger"
        autoFocus
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        {...rest}
      >
        {confirmLabel}
      </Button>
      <Button size={size} variant="ghost" onClick={() => setArmed(false)}>
        Annuler
      </Button>
    </span>
  );
}

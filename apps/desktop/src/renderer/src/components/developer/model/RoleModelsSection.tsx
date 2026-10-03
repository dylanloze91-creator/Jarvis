import { Users } from 'lucide-react';
import { ROLE_LABELS, SPECIALIST_ROLES, type RoleModels, type SpecialistRole } from '@jarvis/core';
import type { DeveloperState } from '../../../../../shared/developerIpc';

/**
 * Modèle de chaque rôle, choisi par l'utilisateur. Le banc réel montre le
 * score du modèle pour ce rôle ; rien n'est choisi à sa place. Vide = le
 * modèle de code.
 */
export function RoleModelsSection({
  state,
  codeModel,
  roleModels,
  saving,
  onChange,
}: {
  state: DeveloperState;
  codeModel: string;
  roleModels: RoleModels;
  saving: boolean;
  onChange: (role: SpecialistRole, model: string | null) => void;
}) {
  const installed = state.model.installedModels;
  const options = [
    ...new Set([...installed, ...Object.values(roleModels).filter(Boolean)]),
  ] as string[];
  const score = (role: SpecialistRole, model: string): string | null => {
    const bench = state.model.realBenches.find((b) => b.model === model);
    const entry = bench?.roles.find((r) => r.role === role);
    return entry && entry.measured ? `banc ${entry.passed}/${entry.measured}` : null;
  };
  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3"
      data-role-models
    >
      <div className="flex items-center gap-2 text-[13px] font-medium text-slate-100">
        <Users className="size-4" /> Modèle par rôle (ton choix)
      </div>
      <p className="text-[11px] leading-snug text-slate-400">
        Vide : le modèle de code ({codeModel || 'pas encore choisi'}). Le score affiché vient du
        banc réel ci-dessous ; aucun modèle n’est choisi d’avance.
      </p>
      <table className="text-left text-[11px] text-slate-300">
        <tbody>
          {SPECIALIST_ROLES.map((role) => {
            const current = roleModels[role] ?? '';
            const effective = current || codeModel;
            const measured = effective ? score(role, effective) : null;
            return (
              <tr key={role} className="border-t border-white/5">
                <td className="py-1 pr-3">{ROLE_LABELS[role]}</td>
                <td className="py-1 pr-3">
                  <select
                    className="no-drag rounded-md border border-white/10 bg-black/40 px-2 py-0.5 text-[11px]"
                    value={current}
                    disabled={saving}
                    aria-label={`Modèle pour ${ROLE_LABELS[role]}`}
                    onChange={(event) => onChange(role, event.target.value || null)}
                  >
                    <option value="">Modèle de code</option>
                    {options.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1 text-slate-500">{measured ?? 'pas mesuré'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export interface QuickActionLike {
  id: string;
  google?: boolean;
}

/** Masque les raccourcis liés à un service non choisi au questionnaire. */
export function filterQuickActionsForQuestionnaire<T extends QuickActionLike>(
  actions: T[],
  input: { completedAt: number | null; preferredServices: string[] | null | undefined },
): T[] {
  if (!input.completedAt) return actions;
  const services = input.preferredServices ?? [];
  return actions.filter((action) => {
    if (action.id === 'mail' || action.google) {
      return services.includes('google');
    }
    return true;
  });
}

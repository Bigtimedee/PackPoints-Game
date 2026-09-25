/**
 * Flags the stale-build reload guard reads. Game pages set the play/submit
 * bits; the fetch wrapper counts in-flight answer POSTs. Neither path changes
 * scoring or card flow.
 */

export interface StaleBuildActivity {
  submittingDepth: number;
  pageSubmitting: boolean;
  daily5Playing: boolean;
  inProgressCard: boolean;
  /** A play session or its results screen is still up. Polls must not reload. */
  holdPlay: boolean;
}

const empty: StaleBuildActivity = {
  submittingDepth: 0,
  pageSubmitting: false,
  daily5Playing: false,
  inProgressCard: false,
  holdPlay: false,
};

let activity: StaleBuildActivity = { ...empty };

export function getStaleBuildActivity(): StaleBuildActivity {
  return activity;
}

export function setStaleBuildActivity(partial: Partial<StaleBuildActivity>): void {
  activity = { ...activity, ...partial };
}

export function noteSubmitDepth(delta: number): void {
  activity = {
    ...activity,
    submittingDepth: Math.max(0, activity.submittingDepth + delta),
  };
}

export function isStaleBuildSubmitting(): boolean {
  return activity.submittingDepth > 0 || activity.pageSubmitting;
}

export function resetStaleBuildActivity(): void {
  activity = { ...empty };
}

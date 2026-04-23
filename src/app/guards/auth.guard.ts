import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { firstValueFrom, timeout, catchError, of, filter } from 'rxjs';

export const authGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (data?.session) {
    const profile = await waitForProfile(supabase);
    if (profile?.is_disabled) {
      await supabase.signOut();
      return router.createUrlTree(['/login']);
    }
    return true;
  }
  return router.createUrlTree(['/login']);
};

/** Wait up to 3 s for the reactive profile populated by onAuthStateChange */
async function waitForProfile(supabase: SupabaseService) {
  return firstValueFrom(
    supabase.currentProfile$.pipe(
      filter(p => p !== null),
      timeout(3000),
      catchError(() => of(null)),
    ),
  );
}

export const adminGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (!data?.session) return router.createUrlTree(['/login']);
  const profile = await waitForProfile(supabase);
  if (profile?.is_disabled) {
    await supabase.signOut();
    return router.createUrlTree(['/login']);
  }
  if (supabase.isMembershipAdmin(profile)) return true;
  return router.createUrlTree(['/membership-card']);
};

export const fullAdminGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (!data?.session) return router.createUrlTree(['/login']);
  const profile = await waitForProfile(supabase);
  if (profile?.is_disabled) {
    await supabase.signOut();
    return router.createUrlTree(['/login']);
  }
  if (supabase.isFullAdmin(profile)) return true;
  return router.createUrlTree(['/membership-card']);
};

export const anyAdminGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (!data?.session) return router.createUrlTree(['/login']);
  const profile = await waitForProfile(supabase);
  if (profile?.is_disabled) {
    await supabase.signOut();
    return router.createUrlTree(['/login']);
  }
  if (supabase.isAnyAdmin(profile)) return true;
  return router.createUrlTree(['/membership-card']);
};

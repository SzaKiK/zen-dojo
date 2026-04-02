import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

export const authGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (data?.session) return true;
  return router.createUrlTree(['/login']);
};

export const adminGuard = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);
  const { data } = await supabase.getSession();
  if (!data?.session) return router.createUrlTree(['/login']);
  const profile = await supabase.getProfile(data.session.user.id);
  if (profile?.is_admin) return true;
  return router.createUrlTree(['/membership-card']);
};

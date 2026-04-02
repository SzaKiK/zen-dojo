import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, Profile, Membership } from '../../services/supabase.service';

@Component({
  selector: 'app-membership-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './membership-card.component.html',
  styleUrl: './membership-card.component.scss',
})
export class MembershipCardComponent implements OnInit {
  profile: Profile | null = null;
  membership: Membership | null = null;
  recentSessions: { title: string; date: string }[] = [];
  loading = true;

  // Demo data for display when Supabase is not configured
  demoProfile: Profile = {
    id: 'demo',
    full_name: 'Kovács Bence',
    avatar_url: 'https://dhkse.hu/dhkse_csoportkep.jpg',
    belt_level: 'yellow',
    qr_code_id: 'DHKSE-2026-0891',
    is_admin: false,
  };

  demoMembership: Membership = {
    id: 'demo',
    user_id: 'demo',
    type: '16 alkalmas bérlet',
    total_sessions: 16,
    remaining_sessions: 4,
    valid_until: '2024-06-30',
    status: 'active',
  };

  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.profile = await this.supabase.getProfile(data.session.user.id);
      if (this.profile) {
        this.membership = await this.supabase.getMembership(this.profile.id);
        const attendance = await this.supabase.getUserAttendance(this.profile.id, 5);
        this.recentSessions = attendance.map((a: any) => ({
          title: a.training_sessions?.title ?? 'Edzés',
          date: new Date(a.checked_in_at).toLocaleDateString('hu-HU', {
            year: 'numeric', month: 'long', day: 'numeric',
          }) + ' • ' + new Date(a.checked_in_at).toLocaleTimeString('hu-HU', {
            hour: '2-digit', minute: '2-digit',
          }),
        }));
      }
    }

    // Fallback to demo data only when not logged in at all
    if (!this.profile) {
      this.profile = this.demoProfile;
      this.membership = this.demoMembership;
    }
    this.loading = false;
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }

  get sessionsUsed(): number {
    const m = this.membership;
    return m ? m.total_sessions - m.remaining_sessions : 0;
  }

  get beltDisplay(): string {
    const beltMap: Record<string, string> = {
      white: 'Fehér öv • White Belt',
      yellow: 'Sárga öv • Yellow Belt',
      orange: 'Narancs öv • Orange Belt',
      green: 'Zöld öv • Green Belt',
      blue: 'Kék öv • Blue Belt',
      purple: 'Lila öv • Purple Belt',
      brown: 'Barna öv • Brown Belt',
      black: 'Fekete öv • Black Belt',
    };
    return beltMap[this.profile?.belt_level ?? 'white'] ?? 'Fehér öv • White Belt';
  }
}

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
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

  // Demo data for display when Supabase is not configured
  demoProfile: Profile = {
    id: 'demo',
    full_name: 'Kovács Bence',
    avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCXTc5TSKofzy94F0LRMlgzkXKlI7c7F98gonmYpvNrp3uJQgCYaa0AVmqI6DiuWS_I5g5Fn95Jw_XXBlkHxJwEwl5K3tourbDJY3c8T3V-twja_MsHlDnCCMbVWH-TAdHQZ4HqkCwvRH8NfW4-EeWV4e0PttCIARpiXObZHLwT9TEtMw7MhjUXuWEg_WIuhi07cg8jonPPEvJ_4A5OUZsb546hGXfh69eSfDmKZBR4l44qDc-CSo2lIuP26Ps8MIkWUIjMKLTL8NI',
    belt_level: 'yellow',
    qr_code_id: 'MB-2024-0891',
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

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.profile = await this.supabase.getProfile(data.session.user.id);
      if (this.profile) {
        this.membership = await this.supabase.getMembership(this.profile.id);
      }
    }

    // Fallback to demo data
    if (!this.profile) {
      this.profile = this.demoProfile;
      this.membership = this.demoMembership;
    }
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

import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SupabaseService, Profile, Membership } from '../../services/supabase.service';
import QRCode from 'qrcode';

@Component({
  selector: 'app-membership-card',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './membership-card.component.html',
  styleUrl: './membership-card.component.scss',
})
export class MembershipCardComponent implements OnInit {
  profile: Profile | null = null;
  membership: Membership | null = null;
  recentSessions: { title: string; date: string }[] = [];
  loading = true;
  qrDataUrl = '';
  isAdmin = false;
  isViewingOther = false;
  currentUserId = '';

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

  constructor(
    private supabase: SupabaseService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.currentUserId = data.session.user.id;
      const currentProfile = await this.supabase.getProfile(data.session.user.id);
      this.isAdmin = currentProfile?.is_admin ?? false;

      // Check if viewing another user's profile (admin feature)
      const targetUserId = this.route.snapshot.paramMap.get('userId');
      if (targetUserId && this.isAdmin && targetUserId !== this.currentUserId) {
        this.isViewingOther = true;
        this.profile = await this.supabase.getProfile(targetUserId);
      } else {
        this.profile = currentProfile;
      }

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

        // Generate QR code
        if (this.profile.qr_code_id) {
          try {
            this.qrDataUrl = await QRCode.toDataURL(this.profile.qr_code_id, {
              width: 140,
              margin: 1,
              color: { dark: '#0a0a1a', light: '#ffffff' },
            });
          } catch { /* QR generation failed, show placeholder */ }
        }
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

  goBack() {
    this.router.navigate(['/members']);
  }

  async adjustSessions(delta: number) {
    if (!this.membership || !this.isAdmin) return;
    const newRemaining = Math.max(0, this.membership.remaining_sessions + delta);
    const newTotal = delta > 0
      ? Math.max(this.membership.total_sessions, newRemaining)
      : this.membership.total_sessions;
    await this.supabase.updateMembership(this.membership.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
    });
    this.membership.remaining_sessions = newRemaining;
    this.membership.total_sessions = newTotal;
  }

  async toggleMembershipStatus() {
    if (!this.membership || !this.isAdmin) return;
    const newStatus = this.membership.status === 'active' ? 'expired' : 'active';
    await this.supabase.updateMembership(this.membership.id, { status: newStatus });
    this.membership.status = newStatus;
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

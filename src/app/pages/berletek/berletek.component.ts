import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, Membership, Profile } from '../../services/supabase.service';

interface MembershipWithProfile extends Membership {
  profiles?: { full_name: string; belt_rank: string | null };
}

@Component({
  selector: 'app-berletek',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './berletek.component.html',
  styleUrl: './berletek.component.scss',
})
export class BerletetComponent implements OnInit {
  memberships: MembershipWithProfile[] = [];
  profiles: Profile[] = [];
  loading = true;
  showNewForm = false;
  saving = false;
  errorMsg = '';
  successMsg = '';
  isAdmin = false;
  currentUserId = '';

  // New membership form
  newBerlet = {
    user_id: '',
    type: 'session_pass' as 'monthly' | 'session_pass' | 'annual',
    total_sessions: 10,
    remaining_sessions: 10,
    valid_until: '',
    status: 'active' as 'active' | 'expired' | 'pending',
  };

  constructor(private supabase: SupabaseService, private router: Router) {}

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.currentUserId = data.session.user.id;
      const profile = await this.supabase.getProfile(data.session.user.id);
      this.isAdmin = profile?.is_admin ?? false;
    }
    await this.loadData();
  }

  async loadData() {
    this.loading = true;
    if (this.isAdmin) {
      this.memberships = (await this.supabase.getAllMemberships()) as MembershipWithProfile[];
      this.profiles = await this.supabase.getAllProfiles();
    } else {
      const m = await this.supabase.getMembership(this.currentUserId);
      this.memberships = m ? [m] : [];
    }
    this.loading = false;
  }

  async saveBerlet() {
    this.errorMsg = '';
    this.successMsg = '';
    if (!this.newBerlet.user_id || !this.newBerlet.valid_until) {
      this.errorMsg = 'Töltsd ki az összes mezőt.';
      return;
    }
    this.saving = true;
    const { error } = await this.supabase.createMembership({
      ...this.newBerlet,
      total_sessions: this.newBerlet.type === 'session_pass' ? this.newBerlet.total_sessions : 0,
      remaining_sessions: this.newBerlet.type === 'session_pass' ? this.newBerlet.total_sessions : 0,
    });
    this.saving = false;
    if (error) {
      this.errorMsg = (error as any).message ?? 'Hiba történt.';
    } else {
      this.successMsg = 'Bérlet sikeresen létrehozva!';
      this.showNewForm = false;
      this.resetForm();
      await this.loadData();
    }
  }

  async toggleStatus(m: Membership) {
    const newStatus = m.status === 'active' ? 'expired' : 'active';
    await this.supabase.updateMembership(m.id, { status: newStatus });
    await this.loadData();
  }

  async deleteMembership(m: Membership) {
    if (!confirm(`Biztosan törlöd ezt a bérletet?`)) return;
    await this.supabase.deleteMembership(m.id);
    await this.loadData();
  }

  async adjustSessions(m: MembershipWithProfile, delta: number) {
    const newRemaining = Math.max(0, m.remaining_sessions + delta);
    const newTotal = delta > 0
      ? Math.max(m.total_sessions, newRemaining)
      : m.total_sessions;
    await this.supabase.updateMembership(m.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
    });
    m.remaining_sessions = newRemaining;
    m.total_sessions = newTotal;
  }

  resetForm() {
    this.newBerlet = {
      user_id: '',
      type: 'session_pass',
      total_sessions: 10,
      remaining_sessions: 10,
      valid_until: '',
      status: 'active',
    };
  }

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      monthly: 'Havi bérlet',
      session_pass: 'Alkalombérlet',
      annual: 'Éves bérlet',
    };
    return map[type] ?? type;
  }

  memberName(m: MembershipWithProfile): string {
    return m.profiles?.full_name ?? this.profiles.find(p => p.id === m.user_id)?.full_name ?? m.user_id;
  }

  statusClass(m: Membership): string {
    if (m.status === 'expired') return 'expired';
    if (m.type === 'session_pass' && m.remaining_sessions <= 0) return 'expired';
    return m.status;
  }

  statusLabel(m: Membership): string {
    if (m.status === 'expired') return 'Lejárt';
    if (m.type === 'session_pass') return `${m.remaining_sessions} / ${m.total_sessions} alkalom`;
    return 'Aktív';
  }

  get defaultValidUntil(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  }
}

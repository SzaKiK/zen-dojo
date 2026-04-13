import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
  isFullAdmin = false;
  currentUserId = '';

  // New membership form
  newBerlet = {
    user_id: '',
    type: 'kombinalt' as 'kombinalt' | 'kempo_cross',
    total_sessions: 10,
    remaining_sessions: 10,
    valid_until: '',
    status: 'active' as 'active' | 'expired' | 'pending',
  };

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.currentUserId = data.session.user.id;
      const profile = await this.supabase.getProfile(data.session.user.id);
      this.isAdmin = this.supabase.isMembershipAdmin(profile);
      this.isFullAdmin = this.supabase.isFullAdmin(profile);
    }
    await this.loadData();
  }

  get nonAdminProfiles(): Profile[] {
    return this.profiles.filter(p => !p.admin_role && !p.is_admin);
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
    if (!this.newBerlet.user_id) {
      this.errorMsg = 'Válassz tagot a bérlethez.';
      return;
    }

    const selectedProfile = this.profiles.find(p => p.id === this.newBerlet.user_id);
    if (selectedProfile && (selectedProfile.admin_role || selectedProfile.is_admin)) {
      this.errorMsg = 'Adminokhoz (edzőkhöz) nem lehet bérletet létrehozni.';
      return;
    }

    const activeMembership = await this.supabase.getMembership(this.newBerlet.user_id);
    if (activeMembership) {
      this.errorMsg = 'A kiválasztott tagnak már van aktív bérlete. Új bérlet csak a jelenlegi lezárása vagy lejárata után hozható létre.';
      return;
    }

    this.saving = true;
    const { error } = await this.supabase.createMembership({
      ...this.newBerlet,
      total_sessions: 10,
      remaining_sessions: 10,
      valid_until: this.newBerlet.valid_until || null,
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
    if (m.status === 'expired') {
      this.errorMsg = 'Lejárt bérlet nem aktiválható újra. Helyette új bérletet kell létrehozni.';
      return;
    }
    const newStatus = 'expired';
    await this.supabase.updateMembership(m.id, { status: newStatus });
    await this.loadData();
  }

  async deleteMembership(m: Membership) {
    if (!confirm(`Biztosan törlöd ezt a bérletet?`)) return;
    await this.supabase.deleteMembership(m.id);
    await this.loadData();
  }

  async adjustSessions(m: MembershipWithProfile, delta: number) {
    if (m.status === 'expired' && delta > 0) {
      this.errorMsg = 'Lejárt bérlethez új bérletet kell létrehozni.';
      return;
    }
    const newRemaining = Math.max(0, m.remaining_sessions + delta);
    const newTotal = delta > 0
      ? Math.max(m.total_sessions, newRemaining)
      : m.total_sessions;
    const newStatus = newRemaining <= 0 ? 'expired' : m.status;
    await this.supabase.updateMembership(m.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
      status: newStatus,
    });
    m.remaining_sessions = newRemaining;
    m.total_sessions = newTotal;
    m.status = newStatus;
  }

  resetForm() {
    this.newBerlet = {
      user_id: '',
      type: 'kombinalt',
      total_sessions: 10,
      remaining_sessions: 10,
      valid_until: '',
      status: 'active',
    };
  }

  selectedUserHasActiveMembership(): boolean {
    if (!this.newBerlet.user_id) return false;
    return this.memberships.some(m => m.user_id === this.newBerlet.user_id && m.status === 'active');
  }

  get headerRoute(): string {
    return this.isAdmin ? '/admin' : '/membership-card';
  }

  typeLabel(type: string): string {
    const map: Record<string, string> = {
      kombinalt: 'Kombinált',
      kempo_cross: 'Kempo, cross',
      session_pass: 'Alkalombérlet',
      monthly: 'Havi bérlet',
      annual: 'Éves bérlet',
    };
    return map[type] ?? type;
  }

  memberName(m: MembershipWithProfile): string {
    return m.profiles?.full_name ?? this.profiles.find(p => p.id === m.user_id)?.full_name ?? m.user_id;
  }

  statusClass(m: Membership): string {
    if (m.status === 'expired') return 'expired';
    if ((m.type === 'kombinalt' || m.type === 'kempo_cross' || m.type === 'session_pass') && m.remaining_sessions <= 0) return 'expired';
    return m.status;
  }

  statusLabel(m: Membership): string {
    if (m.status === 'expired') return 'Lejárt';
    return `${m.remaining_sessions} / ${m.total_sessions} alkalom`;
  }

  canIncreaseSessions(m: Membership): boolean {
    if (m.status === 'expired') return false;
    return true;
  }

  get defaultValidUntil(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  }
}

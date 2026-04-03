import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SupabaseService, Profile, Membership, BeltExam, TrainingCamp, BELT_RANKS } from '../../services/supabase.service';
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

  // Admin-only member details
  beltExams: BeltExam[] = [];
  trainingCamps: TrainingCamp[] = [];
  readonly beltRanks = BELT_RANKS;

  // Admin edit state
  savingProfile = false;
  profileSaveMsg = '';
  editBeltRank = '';
  editMedicalValidity = '';
  editMembershipFeePaid = false;

  // New belt exam form
  newExamDate = '';
  newExamRank = '9.kyu';
  addingExam = false;

  // New training camp form
  newCampDate = '';
  newCampDesc = '';
  addingCamp = false;

  // Demo data for display when Supabase is not configured
  demoProfile: Profile = {
    id: 'demo',
    full_name: 'Kovács Bence',
    avatar_url: 'https://dhkse.hu/dhkse_csoportkep.jpg',
    belt_rank: '7.kyu',
    qr_code_id: 'DHKSE-2026-0891',
    is_admin: false,
    birth_date: null,
    medical_validity: null,
    membership_fee_paid: false,
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

        // Load admin-only data when admin is viewing
        if (this.isAdmin) {
          [this.beltExams, this.trainingCamps] = await Promise.all([
            this.supabase.getBeltExams(this.profile.id),
            this.supabase.getTrainingCamps(this.profile.id),
          ]);
          this.editBeltRank = this.profile.belt_rank ?? '';
          this.editMedicalValidity = this.profile.medical_validity ?? '';
          this.editMembershipFeePaid = this.profile.membership_fee_paid ?? false;
        }

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

  // ── Admin profile fields ─────────────────────────────────────────

  async saveAdminProfileFields() {
    if (!this.profile || !this.isAdmin) return;
    this.savingProfile = true;
    const { error } = await this.supabase.updateProfile(this.profile.id, {
      belt_rank: this.editBeltRank || null,
      medical_validity: this.editMedicalValidity || null,
      membership_fee_paid: this.editMembershipFeePaid,
    });
    this.savingProfile = false;
    if (!error) {
      this.profile = { ...this.profile, belt_rank: this.editBeltRank || null, medical_validity: this.editMedicalValidity || null, membership_fee_paid: this.editMembershipFeePaid };
      this.profileSaveMsg = 'Mentve!';
      setTimeout(() => (this.profileSaveMsg = ''), 2500);
    }
  }

  // ── Belt exams ────────────────────────────────────────────────────

  async addBeltExam() {
    if (!this.profile || !this.newExamDate || !this.newExamRank) return;
    this.addingExam = true;
    await this.supabase.addBeltExam(this.profile.id, this.newExamDate, this.newExamRank);
    this.beltExams = await this.supabase.getBeltExams(this.profile.id);
    this.newExamDate = '';
    this.addingExam = false;
  }

  async deleteBeltExam(id: string) {
    await this.supabase.deleteBeltExam(id);
    this.beltExams = this.beltExams.filter(e => e.id !== id);
  }

  // ── Training camps ────────────────────────────────────────────────

  async addTrainingCamp() {
    if (!this.profile || !this.newCampDate) return;
    this.addingCamp = true;
    await this.supabase.addTrainingCamp(this.profile.id, this.newCampDate, this.newCampDesc);
    this.trainingCamps = await this.supabase.getTrainingCamps(this.profile.id);
    this.newCampDate = '';
    this.newCampDesc = '';
    this.addingCamp = false;
  }

  async deleteTrainingCamp(id: string) {
    await this.supabase.deleteTrainingCamp(id);
    this.trainingCamps = this.trainingCamps.filter(c => c.id !== id);
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '–';
    return new Date(d + 'T00:00:00').toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  isExpiringSoon(d: string | null | undefined): boolean {
    if (!d) return false;
    const diff = new Date(d).getTime() - Date.now();
    return diff > 0 && diff < 60 * 24 * 3600 * 1000; // within 60 days
  }

  isMedicalExpired(d: string | null | undefined): boolean {
    if (!d) return false;
    return new Date(d).getTime() < Date.now();
  }

  get currentYear(): number {
    return new Date().getFullYear();
  }

  get sessionsUsed(): number {
    const m = this.membership;
    return m ? m.total_sessions - m.remaining_sessions : 0;
  }

}


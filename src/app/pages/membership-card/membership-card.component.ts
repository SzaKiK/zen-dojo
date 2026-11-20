import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SupabaseService, Profile, Membership, BeltExam, TrainingCamp, MemberRecordRequest, MemberRecordRequestType, MembershipFeeSeason, BELT_RANKS } from '../../services/supabase.service';
import { DateSelectorComponent } from '../../shared/date-selector/date-selector.component';
import QRCode from 'qrcode';

@Component({
  selector: 'app-membership-card',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, DateSelectorComponent],
  templateUrl: './membership-card.component.html',
  styleUrl: './membership-card.component.scss',
})
export class MembershipCardComponent implements OnInit {
  profile: Profile | null = null;
  membership: Membership | null = null;
  membershipHistory: Membership[] = [];
  recentSessions: { title: string; date: string }[] = [];
  loading = true;
  qrDataUrl = '';
  isAdmin = false;
  isFullAdmin = false;
  canManageMembership = false;
  canEditMemberDetails = false;
  isViewingOther = false;
  currentUserId = '';

  // Admin-only member details
  beltExams: BeltExam[] = [];
  trainingCamps: TrainingCamp[] = [];
  membershipFeeSeasons: MembershipFeeSeason[] = [];
  memberRecordRequests: MemberRecordRequest[] = [];
  readonly beltRanks = BELT_RANKS;

  newRecordRequestType: MemberRecordRequestType = 'belt_exam';
  newRecordDate: string | null = null;
  newRecordBeltRank = '9.kyu';
  newRecordDescription = '';
  submittingRecordRequest = false;
  recordRequestMessage = '';
  recordRequestError = false;

  // Admin edit state
  savingProfile = false;
  profileSaveMsg = '';
  editBirthDate: string | null = null;
  savingBirthDate = false;
  birthDateSaveMsg = '';
  birthDateSaveError = false;
  editBeltRank = '';
  editMedicalValidity = '';
  savingMembershipFeeYear: number | null = null;

  // Full-admin auth account actions (only when viewing another member)
  authEditEmail = '';
  authActionBusy = false;
  authActionMsg = '';
  authActionType: 'success' | 'error' = 'success';

  // New belt exam form
  newExamDate = '';
  newExamRank = '9.kyu';
  addingExam = false;

  // New training camp form
  newCampDate = '';
  newCampDesc = '';
  addingCamp = false;

  showNewMembershipForm = false;
  creatingMembership = false;
  memberActionMsg = '';
  memberActionType: 'success' | 'error' = 'success';

  newMembership = {
    type: 'kombinalt' as 'kombinalt' | 'kempo_cross',
    total_sessions: 10,
    valid_until: '',
    status: 'active' as 'active' | 'expired' | 'pending',
  };

  // Demo data for display when Supabase is not configured
  demoProfile: Profile = {
    id: 'demo',
    full_name: 'Kovács Bence',
    avatar_url: 'https://dhkse.hu/dhkse_csoportkep.jpg',
    belt_rank: '7.kyu',
    qr_code_id: 'DHKSE-2026-0891',
    is_admin: false,
    admin_role: null,
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
      this.canManageMembership = this.supabase.isMembershipAdmin(currentProfile);
      this.isFullAdmin = this.supabase.isFullAdmin(currentProfile);
      this.isAdmin = this.isFullAdmin;
      this.canEditMemberDetails = this.supabase.isTagAdmin(currentProfile);

      // Check if viewing another user's profile (admin feature)
      const targetUserId = this.route.snapshot.paramMap.get('userId');
      if (targetUserId && (this.canManageMembership || this.canEditMemberDetails) && targetUserId !== this.currentUserId) {
        this.isViewingOther = true;
        this.profile = await this.supabase.getProfile(targetUserId);
      } else {
        this.profile = currentProfile;
      }

      if (this.profile) {
        this.editBirthDate = this.profile.birth_date;
        if (this.profile.id === this.currentUserId) {
          this.memberRecordRequests = await this.supabase.getMemberRecordRequests(this.profile.id);
        }
        [this.membership, this.membershipHistory] = await Promise.all([
          this.supabase.getMembership(this.profile.id),
          this.supabase.getMembershipHistory(this.profile.id),
        ]);
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
        if (this.canEditMemberDetails) {
          [this.beltExams, this.trainingCamps, this.membershipFeeSeasons] = await Promise.all([
            this.supabase.getBeltExams(this.profile.id),
            this.supabase.getTrainingCamps(this.profile.id),
            this.supabase.getMembershipFeeSeasons(this.profile.id, this.visibleMembershipFeeSeasons.map(season => season.startYear)),
          ]);
          this.editBeltRank = this.profile.belt_rank ?? '';
          this.editMedicalValidity = this.profile.medical_validity ?? '';
        }

        this.authEditEmail = this.profile.email ?? '';

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

  get headerRoute(): string {
    return this.isViewingOther ? '/members' : '/';
  }

  get canManageAuthAccount(): boolean {
    return this.isFullAdmin && this.isViewingOther && !!this.profile;
  }

  async adjustSessions(delta: number) {
    if (!this.membership || !this.canManageMembership) return;
    if (this.membership.status === 'expired' && delta > 0) {
      this.showMemberMsg('Lejárt bérlethez új bérletet kell létrehozni.', 'error');
      return;
    }
    const newRemaining = Math.max(0, this.membership.remaining_sessions + delta);
    const newTotal = delta > 0
      ? Math.max(this.membership.total_sessions, newRemaining)
      : this.membership.total_sessions;
    const newStatus = newRemaining <= 0 ? 'expired' : this.membership.status;
    await this.supabase.updateMembership(this.membership.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
      status: newStatus,
    });
    this.membership.remaining_sessions = newRemaining;
    this.membership.total_sessions = newTotal;
    this.membership.status = newStatus;
  }

  async toggleMembershipStatus() {
    if (!this.membership || !this.canManageMembership) return;
    if (this.membership.status === 'expired') {
      this.showMemberMsg('Lejárt bérlet nem aktiválható újra. Helyette új bérletet kell létrehozni.', 'error');
      return;
    }
    const newStatus = 'expired';
    await this.supabase.updateMembership(this.membership.id, { status: newStatus });
    this.membership.status = newStatus;
    this.membershipHistory = await this.supabase.getMembershipHistory(this.profile!.id);
  }

  async addMembership() {
    if (!this.profile || !this.canManageMembership) return;
    if (this.profile.admin_role || this.profile.is_admin) {
      this.showMemberMsg('Adminokhoz (edzőkhöz) nem lehet bérletet létrehozni.', 'error');
      return;
    }
    if (this.membership) {
      this.showMemberMsg('Amíg van aktív bérlet, nem hozható létre új. Előbb a mostaninak kell elfogynia vagy lezárulnia.', 'error');
      return;
    }
    this.creatingMembership = true;
    const { error } = await this.supabase.createMembership({
      user_id: this.profile.id,
      type: this.newMembership.type,
      total_sessions: 10,
      remaining_sessions: 10,
      valid_until: this.newMembership.valid_until || null,
      status: this.newMembership.status,
    });
    this.creatingMembership = false;
    if (error) {
      this.showMemberMsg((error as any).message ?? 'Hiba történt a bérlet létrehozásakor.', 'error');
      return;
    }
    [this.membership, this.membershipHistory] = await Promise.all([
      this.supabase.getMembership(this.profile.id),
      this.supabase.getMembershipHistory(this.profile.id),
    ]);
    this.showNewMembershipForm = false;
    this.showMemberMsg('Új bérlet létrehozva.', 'success');
  }

  get isViewedProfileAdmin(): boolean {
    return !!(this.profile && (this.profile.admin_role || this.profile.is_admin));
  }

  get canAddMembership(): boolean {
    if (this.isViewedProfileAdmin) return false;
    return !this.membership;
  }

  private showMemberMsg(msg: string, type: 'success' | 'error') {
    this.memberActionMsg = msg;
    this.memberActionType = type;
    setTimeout(() => (this.memberActionMsg = ''), 3000);
  }

  private showAuthMsg(msg: string, type: 'success' | 'error') {
    this.authActionMsg = msg;
    this.authActionType = type;
    setTimeout(() => (this.authActionMsg = ''), 3500);
  }

  async saveAuthEmail() {
    if (!this.profile || !this.canManageAuthAccount) return;
    const newEmail = this.authEditEmail.trim().toLowerCase();
    if (!newEmail) {
      this.showAuthMsg('Email cím kötelező.', 'error');
      return;
    }

    this.authActionBusy = true;
    const { error } = await this.supabase.updateUserEmailAdmin(this.profile.id, newEmail);
    this.authActionBusy = false;
    if (error) {
      this.showAuthMsg(error.message || 'Email módosítás sikertelen.', 'error');
      return;
    }

    this.profile = { ...this.profile, email: newEmail };
    this.showAuthMsg('Bejelentkezési email frissítve.', 'success');
  }

  async sendPasswordResetForViewedUser() {
    if (!this.profile || !this.canManageAuthAccount) return;
    const email = (this.profile.email ?? '').trim().toLowerCase();
    if (!email) {
      this.showAuthMsg('Nincs mentett email cím a fiókhoz.', 'error');
      return;
    }

    this.authActionBusy = true;
    const { error } = await this.supabase.requestPasswordReset(email);
    this.authActionBusy = false;
    if (error) {
      this.showAuthMsg(error.message || 'Reset email küldése sikertelen.', 'error');
      return;
    }

    this.showAuthMsg(`Reset email elküldve: ${email}`, 'success');
  }

  async softDeleteViewedUser() {
    if (!this.profile || !this.canManageAuthAccount) return;
    if (!confirm(`Biztosan inaktiválod: ${this.profile.full_name}?`)) return;

    this.authActionBusy = true;
    const { error } = await this.supabase.softDeleteUser(this.profile.id, 'Inaktiválás a tagi adatlapról');
    this.authActionBusy = false;
    if (error) {
      this.showAuthMsg(error.message || 'Inaktiválás sikertelen.', 'error');
      return;
    }

    this.profile = { ...this.profile, is_disabled: true, deleted_at: new Date().toISOString() };
    this.showAuthMsg('Fiók inaktiválva (soft delete).', 'success');
  }

  async reactivateViewedUser() {
    if (!this.profile || !this.canManageAuthAccount || !this.profile.is_disabled) return;
    if (!confirm(`Biztosan újraaktiválod: ${this.profile.full_name}?`)) return;

    this.authActionBusy = true;
    const { error } = await this.supabase.reactivateUser(this.profile.id);
    this.authActionBusy = false;
    if (error) {
      this.showAuthMsg(error.message || 'Újraaktiválás sikertelen.', 'error');
      return;
    }

    this.profile = { ...this.profile, is_disabled: false, deleted_at: null };
    this.showAuthMsg('Fiók újraaktiválva.', 'success');
  }

  async hardDeleteViewedUser() {
    if (!this.profile || !this.canManageAuthAccount) return;
    const verification = prompt(`Végleges törlés: ${this.profile.full_name}\nÍrd be: TORLES`);
    if (verification !== 'TORLES') return;

    this.authActionBusy = true;
    const { error } = await this.supabase.hardDeleteUser(this.profile.id);
    this.authActionBusy = false;
    if (error) {
      this.showAuthMsg(error.message || 'Végleges törlés sikertelen.', 'error');
      return;
    }

    await this.router.navigateByUrl('/members');
  }

  // ── Admin profile fields ─────────────────────────────────────────

  async saveAdminProfileFields() {
    if (!this.profile || !this.canEditMemberDetails) return;
    this.savingProfile = true;
    const { error } = await this.supabase.updateProfile(this.profile.id, {
      belt_rank: this.editBeltRank || null,
      medical_validity: this.editMedicalValidity || null,
    });
    this.savingProfile = false;
    if (!error) {
      this.profile = { ...this.profile, belt_rank: this.editBeltRank || null, medical_validity: this.editMedicalValidity || null };
      this.profileSaveMsg = 'Mentve!';
      setTimeout(() => (this.profileSaveMsg = ''), 2500);
    }
  }

  async saveBirthDate() {
    if (!this.profile) return;
    const canEdit = this.isViewingOther
      ? this.canEditMemberDetails
      : this.profile.id === this.currentUserId;
    if (!canEdit) return;

    this.savingBirthDate = true;
    this.birthDateSaveMsg = '';
    const { error } = await this.supabase.updateProfile(this.profile.id, { birth_date: this.editBirthDate });
    this.savingBirthDate = false;
    this.birthDateSaveError = !!error;
    this.birthDateSaveMsg = error ? 'A születési dátum mentése nem sikerült.' : 'Születési dátum mentve.';
    if (!error) this.profile = { ...this.profile, birth_date: this.editBirthDate };
  }

  async toggleMembershipFeeSeason(seasonStartYear: number) {
    if (!this.profile || !this.canEditMemberDetails || this.savingMembershipFeeYear !== null) return;
    const paid = !this.isMembershipFeePaid(seasonStartYear);
    this.savingMembershipFeeYear = seasonStartYear;
    const { error } = await this.supabase.setMembershipFeeSeason(this.profile.id, seasonStartYear, paid);
    this.savingMembershipFeeYear = null;
    if (error) {
      this.profileSaveMsg = 'A tagdíj státusz mentése nem sikerült.';
      return;
    }

    const existing = this.membershipFeeSeasons.find(season => season.season_start_year === seasonStartYear);
    if (existing) {
      existing.paid = paid;
    } else {
      this.membershipFeeSeasons = [...this.membershipFeeSeasons, {
        user_id: this.profile.id,
        season_start_year: seasonStartYear,
        paid,
        updated_by: this.currentUserId,
        updated_at: new Date().toISOString(),
      }];
    }
    this.profileSaveMsg = `${this.seasonLabel(seasonStartYear)} tagdíj mentve.`;
    setTimeout(() => (this.profileSaveMsg = ''), 2500);
  }

  isMembershipFeePaid(seasonStartYear: number): boolean {
    const savedSeason = this.membershipFeeSeasons.find(season => season.season_start_year === seasonStartYear);
    if (savedSeason) return savedSeason.paid;

    const currentSeason = this.visibleMembershipFeeSeasons.find(season => season.current);
    return seasonStartYear === currentSeason?.startYear && !!this.profile?.membership_fee_paid;
  }

  seasonLabel(startYear: number): string {
    return `${startYear}/${startYear + 1}`;
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

  async submitMemberRecordRequest() {
    if (!this.profile || this.profile.id !== this.currentUserId || !this.newRecordDate) return;
    this.submittingRecordRequest = true;
    this.recordRequestMessage = '';
    const { error } = await this.supabase.submitMemberRecordRequest({
      user_id: this.profile.id,
      request_type: this.newRecordRequestType,
      event_date: this.newRecordDate,
      belt_rank: this.newRecordRequestType === 'belt_exam' ? this.newRecordBeltRank : null,
      description: this.newRecordRequestType === 'training_camp' ? this.newRecordDescription.trim() : '',
    });
    this.submittingRecordRequest = false;
    this.recordRequestError = !!error;
    this.recordRequestMessage = error ? 'A beküldés nem sikerült. Próbáld újra.' : 'Beküldve, admin jóváhagyásra vár.';
    if (!error) {
      this.newRecordDate = null;
      this.newRecordDescription = '';
      this.memberRecordRequests = await this.supabase.getMemberRecordRequests(this.profile.id);
    }
  }

  recordRequestTypeLabel(type: MemberRecordRequestType): string {
    return type === 'belt_exam' ? 'Övvizsga' : 'Edzőtábor';
  }

  recordRequestStatusLabel(status: MemberRecordRequest['status']): string {
    return status === 'pending' ? 'Jóváhagyásra vár' : status === 'approved' ? 'Jóváhagyva' : 'Elutasítva';
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

  get visibleMembershipFeeSeasons(): { startYear: number; label: string; current: boolean }[] {
    const now = new Date();
    const currentSeasonStart = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return [-1, 0, 1].map(offset => {
      const startYear = currentSeasonStart + offset;
      return { startYear, label: this.seasonLabel(startYear), current: offset === 0 };
    });
  }

  get sessionsUsed(): number {
    const m = this.membership;
    return m ? m.total_sessions - m.remaining_sessions : 0;
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

  membershipStatusLabel(membership: Membership): string {
    return membership.status === 'active' ? 'Aktív bérlet' : 'Lejárt bérlet';
  }

}


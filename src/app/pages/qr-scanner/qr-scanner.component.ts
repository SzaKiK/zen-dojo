import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import jsQR from 'jsqr';
import { SupabaseService, Profile, Membership, TrainingSession } from '../../services/supabase.service';

type ScannerStep = 'event-select' | 'scanning' | 'member-detail';

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.scss',
})
export class QrScannerComponent implements OnInit, OnDestroy {
  @ViewChild('videoEl') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLCanvasElement>;

  step: ScannerStep = 'event-select';
  processing = false;
  cameraError = '';
  private stream: MediaStream | null = null;
  private rafId = 0;

  // Admin info
  adminId = '';
  isFullAdmin = false;

  // Events
  sessions: TrainingSession[] = [];
  selectedSession: TrainingSession | null = null;
  selectedDate = new Date().toISOString().split('T')[0];

  // Manual member selector
  allProfiles: Profile[] = [];
  memberSelectMode: 'search' | 'lov' = 'search';
  memberSearchTerm = '';
  filteredMembers: Profile[] = [];
  selectedLovMemberId = '';
  loadingManualMember = false;

  // Scanned member
  scannedProfile: Profile | null = null;
  scannedMembership: Membership | null = null;
  memberActionMsg = '';
  memberActionType: 'success' | 'error' = 'success';
  adjustingSession = false;
  editingSessions = false;
  customSessionValue = 0;
  markingAppeared = false;
  deletingMembership = false;
  newMembership = {
    type: 'kombinalt' as 'kombinalt' | 'kempo_cross',
    total_sessions: 10,
    status: 'active' as 'active' | 'expired' | 'pending',
  };
  showNewMembershipForm = false;
  savingMembership = false;

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    this.adminId = data?.session?.user?.id ?? '';
    const adminProfile = this.adminId ? await this.supabase.getProfile(this.adminId) : null;
    this.isFullAdmin = this.supabase.isFullAdmin(adminProfile);
    this.sessions = await this.supabase.getTrainingSessions();
    this.allProfiles = await this.supabase.getAllProfiles();
    if (this.availableSessions.length > 0) {
      this.selectedSession = this.availableSessions[0];
    }
  }

  ngOnDestroy() {
    this.stopCamera();
  }

  // ── Event selection ──────────────────────────────────────────────

  selectSession(s: TrainingSession) {
    this.selectedSession = s;
  }

  onSelectedDateChange() {
    if (this.selectedSession && !this.availableSessions.some(s => s.id === this.selectedSession!.id)) {
      this.selectedSession = null;
    }

    if (!this.selectedSession && this.availableSessions.length > 0) {
      this.selectedSession = this.availableSessions[0];
    }
  }

  startScanning() {
    if (!this.selectedSession) {
      this.showMemberMsg('Becsekkoláshoz előbb válassz edzést.', 'error');
      return;
    }
    this.step = 'scanning';
    this.cameraError = '';
    setTimeout(() => this.startCamera(), 50);
  }

  // ── Manual member selector ──────────────────────────────────────

  onMemberSearchChange() {
    const term = this.memberSearchTerm.trim().toLowerCase();
    if (!term) {
      this.filteredMembers = [];
      return;
    }
    this.filteredMembers = this.allProfiles.filter(p =>
      p.full_name.toLowerCase().includes(term)
    ).slice(0, 10);
  }

  async selectLovMember() {
    const profile = this.allProfiles.find(p => p.id === this.selectedLovMemberId);
    if (profile) await this.selectManualMember(profile);
  }

  async selectManualMember(profile: Profile) {
    if (!this.selectedSession) {
      this.showMemberMsg('Becsekkoláshoz előbb válassz edzést.', 'error');
      return;
    }
    this.loadingManualMember = true;
    this.memberSearchTerm = '';
    this.filteredMembers = [];
    try {
      this.scannedProfile = profile;
      this.scannedMembership = await this.supabase.getMembership(profile.id);
      this.customSessionValue = this.scannedMembership?.remaining_sessions ?? 0;
      this.memberActionMsg = '';
      this.showNewMembershipForm = !this.scannedMembership
        || this.scannedMembership.status !== 'active'
        || this.scannedMembership.remaining_sessions <= 0;
      this.step = 'member-detail';
    } catch {
      this.showMemberMsg('Hiba a tag adatainak betöltésekor.', 'error');
    } finally {
      this.loadingManualMember = false;
    }
  }

  // ── Camera ───────────────────────────────────────────────────────

  async startCamera() {
    this.cameraError = '';
    try {
      // Check permission state first (not supported on all browsers)
      if (navigator.permissions?.query) {
        try {
          const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
          if (status.state === 'denied') {
            this.cameraError = 'A kamera hozzáférés le van tiltva. Kérjük, engedélyezd a böngésző beállításaiban (Beállítások → Webhelyengedélyek → Kamera).';
            return;
          }
        } catch {
          // permissions.query for camera not supported — proceed to getUserMedia
        }
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setTimeout(() => {
        if (this.videoEl?.nativeElement) {
          this.videoEl.nativeElement.srcObject = this.stream;
          this.videoEl.nativeElement.play();
          this.scanLoop();
        }
      }, 100);
    } catch {
      this.cameraError = 'Nem sikerült elérni a kamerát. Engedélyezd a kamera hozzáférést a böngésző beállításaiban.';
    }
  }

  stopCamera() {
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  private scanLoop() {
    if (this.step !== 'scanning') return;
    const video = this.videoEl?.nativeElement;
    const canvas = this.canvasEl?.nativeElement;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
      this.rafId = requestAnimationFrame(() => this.scanLoop());
      return;
    }
    canvas.height = video.videoHeight;
    canvas.width = video.videoWidth;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code && !this.processing) {
      this.onQRFound(code.data);
    } else {
      this.rafId = requestAnimationFrame(() => this.scanLoop());
    }
  }

  async onQRFound(qrData: string) {
    this.processing = true;
    this.stopCamera();
    const profile = await this.supabase.getProfileByQR(qrData);
    if (!profile) {
      this.cameraError = `Nem található tag a QR kóddal: ${qrData}`;
      this.processing = false;
      this.step = 'scanning';
      setTimeout(() => this.startCamera(), 100);
      return;
    }
    this.scannedProfile = profile;
    this.scannedMembership = await this.supabase.getMembership(profile.id);
    this.customSessionValue = this.scannedMembership?.remaining_sessions ?? 0;
    this.memberActionMsg = '';
    this.showNewMembershipForm = !this.scannedMembership
      || this.scannedMembership.status !== 'active'
      || this.scannedMembership.remaining_sessions <= 0;
    this.step = 'member-detail';
    this.processing = false;
  }

  backToEvents() {
    this.step = 'event-select';
    this.scannedProfile = null;
    this.scannedMembership = null;
    this.memberActionMsg = '';
  }

  scanAgain() {
    this.scannedProfile = null;
    this.scannedMembership = null;
    this.cameraError = '';
    this.memberActionMsg = '';
    this.step = 'scanning';
    setTimeout(() => this.startCamera(), 50);
  }

  // ── Membership management ─────────────────────────────────────────

  async toggleMembershipStatus() {
    if (!this.scannedMembership) return;
    if (this.scannedMembership.status === 'expired') {
      this.showMemberMsg('Lejárt bérlet nem aktiválható újra. Helyette új bérletet kell létrehozni.', 'error');
      return;
    }
    const newStatus = 'expired';
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, { status: newStatus });
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, status: newStatus };
      this.showMemberMsg('Bérlet inaktiválva.', 'success');
    } else {
      this.showMemberMsg('Hiba történt.', 'error');
    }
  }

  async adjustSessions(delta: number) {
    if (!this.scannedMembership) return;
    if (this.scannedMembership.status === 'expired' && delta > 0) {
      this.showMemberMsg('Lejárt tagsághoz új tagságot kell létrehozni.', 'error');
      return;
    }
    this.adjustingSession = true;
    const newRemaining = Math.max(0, this.scannedMembership.remaining_sessions + delta);
    const newTotal = delta > 0 ? Math.max(this.scannedMembership.total_sessions, newRemaining) : this.scannedMembership.total_sessions;
    const newStatus = newRemaining <= 0 ? 'expired' : this.scannedMembership.status;
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
      status: newStatus,
    });
    this.adjustingSession = false;
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, remaining_sessions: newRemaining, total_sessions: newTotal, status: newStatus };
      this.customSessionValue = newRemaining;
    } else {
      this.showMemberMsg('Hiba a módosításnál.', 'error');
    }
  }

  async setCustomSessions() {
    if (!this.scannedMembership) return;
    if (this.scannedMembership.status === 'expired') {
      this.showMemberMsg('Lejárt tagsághoz új tagságot kell létrehozni.', 'error');
      return;
    }
    const val = Math.max(0, this.customSessionValue);
    const newTotal = Math.max(this.scannedMembership.total_sessions, val);
    const newStatus = val <= 0 ? 'expired' : this.scannedMembership.status;
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, {
      remaining_sessions: val,
      total_sessions: newTotal,
      status: newStatus,
    });
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, remaining_sessions: val, total_sessions: newTotal, status: newStatus };
      this.editingSessions = false;
      this.showMemberMsg('Alkalmak frissítve.', 'success');
    } else {
      this.showMemberMsg('Hiba a módosításnál.', 'error');
    }
  }

  async deleteMembership() {
    if (!this.scannedMembership) return;
    if (!confirm('Biztosan törlöd ezt a bérletet?')) return;
    this.deletingMembership = true;
    const { error } = await this.supabase.deleteMembership(this.scannedMembership.id);
    this.deletingMembership = false;
    if (!error) {
      this.scannedMembership = null;
      this.showMemberMsg('Bérlet törölve.', 'success');
    } else {
      this.showMemberMsg('Hiba törléskor.', 'error');
    }
  }

  async saveNewMembership() {
    if (!this.scannedProfile) return;
    if (this.scannedProfile.admin_role || this.scannedProfile.is_admin) {
      this.showMemberMsg('Adminokhoz (edzőkhöz) nem lehet bérletet létrehozni.', 'error');
      return;
    }
    if (this.scannedMembership) {
      this.showMemberMsg('A tagnak már van aktív bérlete. Új bérlet csak a jelenlegi lezárása vagy lejárata után hozható létre.', 'error');
      return;
    }
    this.savingMembership = true;
    const { error } = await this.supabase.createMembership({
      user_id: this.scannedProfile.id,
      type: this.newMembership.type,
      total_sessions: 10,
      remaining_sessions: 10,
      valid_until: null,
      status: this.newMembership.status,
    });
    this.savingMembership = false;
    if (!error) {
      this.scannedMembership = await this.supabase.getMembership(this.scannedProfile.id);
      this.showNewMembershipForm = false;
      this.showMemberMsg('Bérlet létrehozva!', 'success');
    } else {
      this.showMemberMsg((error as any).message ?? 'Hiba történt.', 'error');
    }
  }

  get canAddMembership(): boolean {
    if (this.scannedProfile && (this.scannedProfile.admin_role || this.scannedProfile.is_admin)) return false;
    return !this.scannedMembership;
  }

  get scannedProfileIsAdmin(): boolean {
    return !!(this.scannedProfile && (this.scannedProfile.admin_role || this.scannedProfile.is_admin));
  }

  // ── Event attendance ──────────────────────────────────────────────

  async markAppeared() {
    if (!this.selectedSession || !this.scannedProfile) return;
    this.markingAppeared = true;
    // First attempt (no force)
    const result = await this.supabase.logEventAttendance(this.adminId, this.scannedProfile.id, this.selectedSession.id);
    this.markingAppeared = false;

    if (!result.error) {
      this.scannedMembership = await this.supabase.getMembership(this.scannedProfile.id);
      this.showMemberMsg('Megjelenés rögzítve!', 'success');
      return;
    }

    // If the error is a duplicate, ask for confirmation and retry with force
    const isDuplicate = /megjel.{0,4}lt erre az/i.test(result.error.message ?? '');
    if (isDuplicate) {
      const confirmed = confirm(
        `${this.scannedProfile.full_name} erre az edzésre már be van jelölve ma.\n` +
        `Biztosan rögzítesz egy második megjelenést?`
      );
      if (!confirmed) return;
      this.markingAppeared = true;
      const forced = await this.supabase.logEventAttendance(this.adminId, this.scannedProfile.id, this.selectedSession.id, true);
      this.markingAppeared = false;
      if (!forced.error) {
        this.scannedMembership = await this.supabase.getMembership(this.scannedProfile.id);
        this.showMemberMsg('Második megjelenés rögzítve!', 'success');
      } else {
        this.showMemberMsg(forced.error.message ?? 'Hiba.', 'error');
      }
    } else {
      this.showMemberMsg(result.error.message ?? 'Hiba.', 'error');
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private showMemberMsg(msg: string, type: 'success' | 'error') {
    this.memberActionMsg = msg;
    this.memberActionType = type;
    setTimeout(() => (this.memberActionMsg = ''), 3000);
  }

  get membershipStatusLabel(): string {
    const m = this.scannedMembership;
    if (!m) return 'Nincs bérlet';
    if (m.status === 'expired') return 'Lejárt bérlet';
    return `${this.typeLabel(m.type)} – ${m.remaining_sessions}/${m.total_sessions} alkalom`;
  }

  get membershipStatusClass(): string {
    const m = this.scannedMembership;
    if (!m || m.status === 'expired') return 'expired';
    if (m.remaining_sessions <= 0) return 'expired';
    return 'active';
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

  sessionLabel(s: TrainingSession): string {
    return `${this.dayLabel(s.day_of_week)} • ${s.start_time.substring(0, 5)}–${s.end_time.substring(0, 5)} • ${s.title} • ${this.sessionLocation(s)}`;
  }

  dayLabel(dayOfWeek: number): string {
    const days: Record<number, string> = {
      1: 'Hétfő',
      2: 'Kedd',
      3: 'Szerda',
      4: 'Csütörtök',
      5: 'Péntek',
      6: 'Szombat',
      7: 'Vasárnap',
      0: 'Vasárnap',
    };
    return days[dayOfWeek] ?? `Nap ${dayOfWeek}`;
  }

  private isoWeekday(dateIso: string): number {
    const d = new Date(`${dateIso}T00:00:00`);
    const jsDow = d.getDay();
    return jsDow === 0 ? 7 : jsDow;
  }

  get selectedDateDayName(): string {
    return this.dayLabel(this.isoWeekday(this.selectedDate));
  }

  get availableSessions(): TrainingSession[] {
    const day = this.isoWeekday(this.selectedDate);
    return this.sessions
      .filter((s) => s.day_of_week === day)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  sessionLocation(s: TrainingSession): string {
    if (s.location) return s.location;
    return s.instructor_name.includes('Rácz') ? 'Senshi Usagi, Tabajd' : 'Dojo Metzger, Bicske';
  }

  get dashboardRoute(): string {
    return this.isFullAdmin ? '/admin' : '/berletek';
  }

  get canIncreaseSessions(): boolean {
    if (!this.scannedMembership) return false;
    if (this.scannedMembership.status === 'expired') return false;
    return true;
  }
}

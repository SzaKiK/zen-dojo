import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import jsQR from 'jsqr';
import { SupabaseService, Profile, Membership, TrainingSession, SessionSubscriber } from '../../services/supabase.service';

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

  // Events
  sessions: TrainingSession[] = [];
  selectedSession: TrainingSession | null = null;
  selectedDate = new Date().toISOString().split('T')[0];
  subscribers: SessionSubscriber[] = [];
  loadingSubscribers = false;

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
    valid_until: this.defaultValidUntil,
    status: 'active' as 'active' | 'expired' | 'pending',
  };
  showNewMembershipForm = false;
  savingMembership = false;

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    this.adminId = data?.session?.user?.id ?? '';
    this.sessions = await this.supabase.getTrainingSessions();
  }

  ngOnDestroy() {
    this.stopCamera();
  }

  // ── Event selection ──────────────────────────────────────────────

  selectSession(s: TrainingSession | null) {
    this.selectedSession = s;
    this.subscribers = [];
    if (s) this.loadSubscribers();
  }

  async loadSubscribers() {
    if (!this.selectedSession) return;
    this.loadingSubscribers = true;
    this.subscribers = await this.supabase.getSessionSubscribers(this.selectedSession.id, this.selectedDate);
    this.loadingSubscribers = false;
  }

  startScanning() {
    this.step = 'scanning';
    this.cameraError = '';
    setTimeout(() => this.startCamera(), 50);
  }

  // ── Camera ───────────────────────────────────────────────────────

  async startCamera() {
    this.cameraError = '';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setTimeout(() => {
        if (this.videoEl?.nativeElement) {
          this.videoEl.nativeElement.srcObject = this.stream;
          this.videoEl.nativeElement.play();
          this.scanLoop();
        }
      }, 100);
    } catch {
      this.cameraError = 'Nem sikerült elérni a kamerát. Engedélyezd a kamera hozzáférést.';
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
    this.showNewMembershipForm = false;
    this.step = 'member-detail';
    this.processing = false;
    if (this.selectedSession) await this.loadSubscribers();
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
    const newStatus = this.scannedMembership.status === 'active' ? 'expired' : 'active';
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, { status: newStatus });
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, status: newStatus };
      this.showMemberMsg(newStatus === 'active' ? 'Bérlet aktiválva.' : 'Bérlet deaktiválva.', 'success');
    } else {
      this.showMemberMsg('Hiba történt.', 'error');
    }
  }

  async adjustSessions(delta: number) {
    if (!this.scannedMembership) return;
    this.adjustingSession = true;
    const newRemaining = Math.max(0, this.scannedMembership.remaining_sessions + delta);
    const newTotal = delta > 0 ? Math.max(this.scannedMembership.total_sessions, newRemaining) : this.scannedMembership.total_sessions;
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, {
      remaining_sessions: newRemaining,
      total_sessions: newTotal,
    });
    this.adjustingSession = false;
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, remaining_sessions: newRemaining, total_sessions: newTotal };
      this.customSessionValue = newRemaining;
    } else {
      this.showMemberMsg('Hiba a módosításnál.', 'error');
    }
  }

  async setCustomSessions() {
    if (!this.scannedMembership) return;
    const val = Math.max(0, this.customSessionValue);
    const newTotal = Math.max(this.scannedMembership.total_sessions, val);
    const { error } = await this.supabase.updateMembership(this.scannedMembership.id, {
      remaining_sessions: val,
      total_sessions: newTotal,
    });
    if (!error) {
      this.scannedMembership = { ...this.scannedMembership, remaining_sessions: val, total_sessions: newTotal };
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
    this.savingMembership = true;
    const { error } = await this.supabase.createMembership({
      user_id: this.scannedProfile.id,
      type: this.newMembership.type,
      total_sessions: this.newMembership.total_sessions,
      remaining_sessions: this.newMembership.total_sessions,
      valid_until: this.newMembership.valid_until,
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

  // ── Event attendance ──────────────────────────────────────────────

  get isSubscribedToEvent(): boolean {
    if (!this.selectedSession || !this.scannedProfile) return false;
    return this.subscribers.some(s => s.user_id === this.scannedProfile!.id);
  }

  get hasAppearedAtEvent(): boolean {
    if (!this.selectedSession || !this.scannedProfile) return false;
    return this.subscribers.some(s => s.user_id === this.scannedProfile!.id && s.appeared);
  }

  async markAppeared() {
    if (!this.selectedSession || !this.scannedProfile) return;
    this.markingAppeared = true;
    const result = await this.supabase.logEventAttendance(this.adminId, this.scannedProfile.id, this.selectedSession.id);
    this.markingAppeared = false;
    if (!result.error) {
      this.showMemberMsg('Megjelenés rögzítve!', 'success');
      await this.loadSubscribers();
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

  get defaultValidUntil(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().split('T')[0];
  }

  sessionLabel(s: TrainingSession): string {
    const days: Record<number, string> = { 1: 'H', 2: 'K', 3: 'Sze', 4: 'Cs', 5: 'P', 6: 'Szo', 0: 'V' };
    return `${days[s.day_of_week] ?? ''} ${s.start_time.substring(0, 5)} – ${s.title}`;
  }
}

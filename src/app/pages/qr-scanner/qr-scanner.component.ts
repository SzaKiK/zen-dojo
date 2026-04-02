import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import jsQR from 'jsqr';
import { SupabaseService, Profile, Membership } from '../../services/supabase.service';

interface ScanResult {
  profile: Profile;
  membership: Membership | null;
  checkedIn: boolean;
  error?: string;
}

@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './qr-scanner.component.html',
  styleUrl: './qr-scanner.component.scss',
})
export class QrScannerComponent implements OnInit, OnDestroy {
  @ViewChild('videoEl') videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasEl') canvasEl!: ElementRef<HTMLCanvasElement>;

  scanning = false;
  processing = false;
  result: ScanResult | null = null;
  cameraError = '';
  private stream: MediaStream | null = null;
  private rafId = 0;

  constructor(private supabase: SupabaseService) {}

  ngOnInit() {
    this.startCamera();
  }

  ngOnDestroy() {
    this.stopCamera();
  }

  async startCamera() {
    this.cameraError = '';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      // Wait for ViewChild to be available
      setTimeout(() => {
        if (this.videoEl?.nativeElement) {
          this.videoEl.nativeElement.srcObject = this.stream;
          this.videoEl.nativeElement.play();
          this.scanning = true;
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
    this.scanning = false;
  }

  private scanLoop() {
    if (!this.scanning) return;
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
      this.result = null;
      this.cameraError = `Nem található tag a QR kóddal: ${qrData}`;
      this.processing = false;
      return;
    }
    const membership = await this.supabase.getMembership(profile.id);
    // Log attendance
    await this.supabase.logAttendance(profile.id);
    // Decrement session-pass if applicable
    if (membership && membership.type === 'session_pass' && (membership.remaining_sessions ?? 0) > 0) {
      await this.supabase.decrementSession(membership.id, membership.remaining_sessions);
    }
    this.result = { profile, membership, checkedIn: true };
    this.processing = false;
  }

  scanAgain() {
    this.result = null;
    this.cameraError = '';
    this.processing = false;
    this.startCamera();
  }

  get membershipStatus(): string {
    const m = this.result?.membership;
    if (!m) return 'Nincs aktív bérlet';
    if (m.status === 'expired') return 'Lejárt bérlet';
    if (m.type === 'session_pass') return `Alkalombérlet – ${m.remaining_sessions} alkalom maradt`;
    if (m.type === 'monthly') return 'Havi bérlet – AKTÍV';
    if (m.type === 'annual') return 'Éves bérlet – AKTÍV';
    return m.type;
  }

  get membershipStatusClass(): string {
    const m = this.result?.membership;
    if (!m || m.status === 'expired') return 'expired';
    if (m.type === 'session_pass' && m.remaining_sessions <= 0) return 'expired';
    return 'active';
  }
}

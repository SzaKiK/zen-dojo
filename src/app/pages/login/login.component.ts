import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';
import { firstValueFrom, filter, timeout, catchError, of } from 'rxjs';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  error = '';
  loading = false;
  resetEmail = '';
  resetLoading = false;
  resetMessage = '';
  resetError = '';
  showResetPanel = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async ngOnInit() {
    // Older reset emails may still point to /login. In recovery mode, always
    // send user to the password reset screen instead of role-based redirect.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const isRecoveryUrl = hash.includes('type=recovery') || search.includes('type=recovery');
    if (isRecoveryUrl || this.supabase.isPasswordRecoveryFlow()) {
      await this.router.navigateByUrl('/reset-password');
      return;
    }

    // If already logged in, redirect to appropriate page
    try {
      const { data } = await this.supabase.getSession();
      if (data?.session) {
        if (this.supabase.isPasswordRecoveryFlow()) {
          await this.router.navigateByUrl('/reset-password');
          return;
        }
        await this.redirectAfterLogin();
      }
    } catch {
      // Session check failed — just show the login form
    }
  }

  async onSubmit() {
    this.loading = true;
    this.error = '';
    try {
      const { error } = await this.supabase.signIn(this.email, this.password);
      if (error) {
        this.error = error.message;
        return;
      }
      await this.redirectAfterLogin();
    } catch (e: any) {
      this.error = e?.message || 'Hiba történt a bejelentkezés során. Próbáld újra.';
    } finally {
      this.loading = false;
    }
  }

  async requestPasswordReset() {
    this.resetLoading = true;
    this.resetError = '';
    this.resetMessage = '';

    const emailToReset = (this.resetEmail || this.email).trim().toLowerCase();
    if (!emailToReset) {
      this.resetLoading = false;
      this.resetError = 'Adj meg egy email címet a jelszó-visszaállításhoz.';
      return;
    }

    const { error } = await this.supabase.requestPasswordReset(emailToReset);
    this.resetLoading = false;

    if (error) {
      this.resetError = error.message || 'Nem sikerült reset emailt küldeni.';
      return;
    }

    this.resetMessage = `Reset email elküldve: ${emailToReset}`;
  }

  async sendResetFromLoginEmail() {
    this.resetEmail = (this.email || '').trim().toLowerCase();
    this.showResetPanel = true;
  }

  private async redirectAfterLogin() {
    // Wait for the reactive profile from onAuthStateChange (max 3s), then redirect by role.
    // This avoids a separate getProfile call that could hang or fail.
    const profile = await firstValueFrom(
      this.supabase.currentProfile$.pipe(
        filter(p => p !== null),
        timeout(3000),
        catchError(() => of(null))
      )
    );
    if (profile?.is_disabled) {
      await this.supabase.signOut();
      this.error = 'A fiók inaktív. Kérlek keresd a vezető edzőt.';
      return;
    }

    if (this.supabase.isFullAdmin(profile)) {
      await this.router.navigateByUrl('/admin');
    } else if (this.supabase.isMembershipAdmin(profile)) {
      await this.router.navigateByUrl('/berletek');
    } else {
      await this.router.navigateByUrl('/membership-card');
    }
  }
}

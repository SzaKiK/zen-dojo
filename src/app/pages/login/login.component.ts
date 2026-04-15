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

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async ngOnInit() {
    // If already logged in, redirect to appropriate page
    try {
      const { data } = await this.supabase.getSession();
      if (data?.session) {
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
    if (this.supabase.isFullAdmin(profile)) {
      await this.router.navigateByUrl('/admin');
    } else if (this.supabase.isMembershipAdmin(profile)) {
      await this.router.navigateByUrl('/berletek');
    } else {
      await this.router.navigateByUrl('/membership-card');
    }
  }
}

import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent {
  password = '';
  confirmPassword = '';
  loading = false;
  error = '';
  message = '';

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async onSubmit() {
    this.error = '';
    this.message = '';

    if (!this.password || this.password.length < 6) {
      this.error = 'A jelszónak legalább 6 karakter hosszúnak kell lennie.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'A két jelszó nem egyezik.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.updatePassword(this.password);
    this.loading = false;

    if (error) {
      this.error = error.message || 'Nem sikerült frissíteni a jelszót.';
      return;
    }

    this.message = 'Jelszó sikeresen frissítve. Most bejelentkezhetsz az új jelszóval.';
    await this.supabase.signOut();
    setTimeout(() => {
      this.router.navigateByUrl('/login');
    }, 800);
  }
}

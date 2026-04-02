import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  email = '';
  password = '';
  error = '';
  loading = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async onSubmit() {
    this.loading = true;
    this.error = '';
    const { error, data } = await this.supabase.signIn(this.email, this.password);
    if (error) {
      this.loading = false;
      this.error = error.message;
      return;
    }
    // Check admin role and redirect accordingly
    const userId = data?.session?.user?.id;
    if (userId) {
      const profile = await this.supabase.getProfile(userId);
      if (profile?.is_admin) {
        this.router.navigate(['/admin']);
      } else {
        this.router.navigate(['/membership-card']);
      }
    } else {
      this.router.navigate(['/membership-card']);
    }
    this.loading = false;
  }
}

import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  fullName = '';
  email = '';
  birthDate = '';
  password = '';
  confirmPassword = '';
  error = '';
  success = '';
  loading = false;

  constructor(
    private supabase: SupabaseService,
    private router: Router
  ) {}

  async onSubmit() {
    this.error = '';
    this.success = '';

    if (this.password !== this.confirmPassword) {
      this.error = 'A jelszavak nem egyeznek.';
      return;
    }

    if (this.password.length < 6) {
      this.error = 'A jelszónak legalább 6 karakter hosszúnak kell lennie.';
      return;
    }

    this.loading = true;
    const { error } = await this.supabase.signUp(this.email, this.password, this.fullName, this.birthDate || undefined);
    this.loading = false;

    if (error) {
      this.error = error.message;
    } else {
      this.success = 'Sikeres regisztráció! Ellenőrizd az e-mail fiókod a megerősítéshez.';
    }
  }
}

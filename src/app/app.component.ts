import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { ThemeService } from './services/theme.service';
import { SupabaseService, Profile } from './services/supabase.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
  currentProfile: Profile | null = null;
  private sub?: Subscription;

  constructor(
    readonly theme: ThemeService,
    private supabase: SupabaseService,
    private router: Router
  ) {}

  ngOnInit() {
    this.sub = this.supabase.currentProfile$.subscribe(profile => {
      this.currentProfile = profile;
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  get isLoggedIn(): boolean {
    return !!this.currentProfile;
  }

  get isAdmin(): boolean {
    return this.supabase.isMembershipAdmin(this.currentProfile);
  }

  get isFullAdmin(): boolean {
    return this.supabase.isFullAdmin(this.currentProfile);
  }

  get dashboardRoute(): string {
    if (this.supabase.isFullAdmin(this.currentProfile)) return '/admin';
    if (this.supabase.isMembershipAdmin(this.currentProfile)) return '/berletek';
    return '/membership-card';
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }
}

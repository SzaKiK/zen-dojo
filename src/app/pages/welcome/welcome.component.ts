import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { SupabaseService, Profile } from '../../services/supabase.service';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './welcome.component.html',
  styleUrl: './welcome.component.scss',
})
export class WelcomeComponent implements OnInit, OnDestroy {
  currentYear = new Date().getFullYear();
  profile: Profile | null = null;
  private sub?: Subscription;

  constructor(private supabase: SupabaseService) {}

  ngOnInit() {
    this.sub = this.supabase.currentProfile$.subscribe(p => {
      this.profile = p;
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  get isLoggedIn(): boolean {
    return !!this.profile;
  }

  get isAdmin(): boolean {
    return this.supabase.isMembershipAdmin(this.profile);
  }

  get isFullAdmin(): boolean {
    return this.supabase.isFullAdmin(this.profile);
  }

  get dashboardRoute(): string {
    if (this.supabase.isFullAdmin(this.profile)) return '/admin';
    if (this.supabase.isMembershipAdmin(this.profile)) return '/berletek';
    return '/membership-card';
  }
}

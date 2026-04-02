import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

interface CheckinRow {
  initials: string;
  name: string;
  belt: string;
  time: string;
  ago: string;
}

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent implements OnInit {
  attendancePercent = 0;
  totalToday = 0;
  totalMembers = 0;
  expiringCount = 0;
  recentCheckins: CheckinRow[] = [];
  loading = true;

  constructor(private supabase: SupabaseService, private router: Router) {}

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }

  async ngOnInit() {
    const [stats, attendance, profiles, memberships] = await Promise.all([
      this.supabase.getAttendanceStats(),
      this.supabase.getRecentAttendance(10),
      this.supabase.getAllProfiles(),
      this.supabase.getAllMemberships(),
    ]);

    this.totalToday = stats.today;
    this.totalMembers = profiles.length;
    this.attendancePercent = this.totalMembers > 0
      ? Math.round((stats.today / this.totalMembers) * 100)
      : 0;

    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    this.expiringCount = memberships.filter(m =>
      m.status === 'active' && new Date(m.valid_until) < soon
    ).length;

    this.recentCheckins = attendance.map((row: any) => {
      const name: string = row.profiles?.full_name ?? 'Ismeretlen';
      const initials = name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
      const checkedAt = new Date(row.checked_in_at);
      const diffMin = Math.round((Date.now() - checkedAt.getTime()) / 60000);
      const ago = diffMin < 1 ? 'Éppen most' : diffMin < 60 ? `${diffMin} perce` : `${Math.floor(diffMin/60)} órája`;
      return {
        initials,
        name,
        belt: row.profiles?.belt_level ? this.beltLabel(row.profiles.belt_level) : '',
        time: checkedAt.toTimeString().slice(0, 5),
        ago,
      };
    });

    this.loading = false;
  }

  private beltLabel(level: string): string {
    const map: Record<string, string> = {
      white: 'Fehér öv', yellow: 'Sárga öv', orange: 'Narancs öv',
      green: 'Zöld öv', blue: 'Kék öv', purple: 'Lila öv',
      brown: 'Barna öv', black: 'Fekete öv',
    };
    return map[level] ?? level;
  }
}

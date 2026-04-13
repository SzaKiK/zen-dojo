import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
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
  activeMembershipCount = 0;
  recentCheckins: CheckinRow[] = [];
  showAllCheckins = false;
  loading = true;

  constructor(private supabase: SupabaseService) {}

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

    this.activeMembershipCount = memberships.filter(m =>
      m.status === 'active' && m.remaining_sessions > 0
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
        belt: row.profiles?.belt_rank ?? '',
        time: checkedAt.toTimeString().slice(0, 5),
        ago,
      };
    });

    this.loading = false;
  }

  get displayedCheckins(): CheckinRow[] {
    return this.showAllCheckins ? this.recentCheckins : this.recentCheckins.slice(0, 6);
  }

  toggleShowAllCheckins() {
    this.showAllCheckins = !this.showAllCheckins;
  }
}

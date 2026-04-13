import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../../services/supabase.service';

interface AuditMonthlyRow {
  month_start: string;
  admin_name: string;
  action_type: string;
  membership_type: string;
  action_count: number;
}

interface AuditLogRow {
  id: string;
  created_at: string;
  action_type: string;
  membership_type: string | null;
  details: any;
  profiles?: { full_name: string };
  target_profile?: { full_name: string };
}

interface MonthStat {
  label: string;
  count: number;
  pct: number;
}

interface AdminStat {
  name: string;
  count: number;
  pct: number;
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './audit-log.component.html',
  styleUrl: './audit-log.component.scss',
})
export class AuditLogComponent implements OnInit {
  loading = true;
  activeTab: 'stats' | 'logs' = 'stats';
  monthly: AuditMonthlyRow[] = [];
  logs: AuditLogRow[] = [];

  currentMonthCreated = 0;
  totalCreated = 0;
  totalUpdated = 0;
  totalDeleted = 0;
  totalAttendance = 0;
  monthlyBerletStats: MonthStat[] = [];
  adminBerletStats: AdminStat[] = [];

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const [monthly, logs] = await Promise.all([
      this.supabase.getAdminActionMonthlySummary(),
      this.supabase.getAdminActionLogs(400),
    ]);
    this.monthly = monthly as AuditMonthlyRow[];
    this.logs = logs as AuditLogRow[];
    this.computeStats();
    this.loading = false;
  }

  private computeStats() {
    // Aggregate monthly creation counts and admin breakdown from the summary view
    const creationByMonth = new Map<string, number>();
    const creationByAdmin = new Map<string, number>();

    for (const row of this.monthly) {
      if (row.action_type === 'membership_created') {
        const key = row.month_start;
        creationByMonth.set(key, (creationByMonth.get(key) ?? 0) + row.action_count);
        creationByAdmin.set(row.admin_name, (creationByAdmin.get(row.admin_name) ?? 0) + row.action_count);
      }
      // Totals across all time in the data
      const count = row.action_count;
      if (row.action_type === 'membership_created') this.totalCreated += count;
      else if (row.action_type === 'membership_updated') this.totalUpdated += count;
      else if (row.action_type === 'membership_deleted') this.totalDeleted += count;
      else if (row.action_type === 'attendance_recorded') this.totalAttendance += count;
    }

    // Build admin breakdown sorted by count descending
    const adminStats: AdminStat[] = Array.from(creationByAdmin.entries())
      .map(([name, count]) => ({ name, count, pct: 0 }))
      .sort((a, b) => b.count - a.count);
    const maxAdmin = Math.max(...adminStats.map(a => a.count), 1);
    for (const a of adminStats) {
      a.pct = (a.count / maxAdmin) * 100;
    }
    this.adminBerletStats = adminStats;

    // Build last 6 months of bar chart data
    const now = new Date();
    const months: MonthStat[] = [];
    const huMonths = ['jan.', 'feb.', 'már.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];

    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const isoKey = d.toISOString().slice(0, 10);
      const count = creationByMonth.get(isoKey) ?? 0;
      const label = `${d.getFullYear()}. ${huMonths[d.getMonth()]}`;
      months.push({ label, count, pct: 0 });
    }

    // Current month
    this.currentMonthCreated = months[0]?.count ?? 0;

    // Calculate bar percentages
    const maxCount = Math.max(...months.map(m => m.count), 1);
    for (const m of months) {
      m.pct = (m.count / maxCount) * 100;
    }

    this.monthlyBerletStats = months;
  }

  fmtDate(value: string): string {
    return new Date(value).toLocaleString('hu-HU');
  }

  actionIcon(type: string): string {
    switch (type) {
      case 'membership_created': return 'add_circle';
      case 'membership_updated': return 'edit';
      case 'membership_deleted': return 'delete';
      case 'attendance_recorded': return 'how_to_reg';
      case 'role_changed': return 'admin_panel_settings';
      default: return 'info';
    }
  }

  actionLabel(type: string): string {
    switch (type) {
      case 'membership_created': return 'Bérlet létrehozva';
      case 'membership_updated': return 'Bérlet módosítva';
      case 'membership_deleted': return 'Bérlet törölve';
      case 'attendance_recorded': return 'Jelenlét rögzítve';
      case 'role_changed': return 'Jogosultság módosítva';
      default: return type;
    }
  }

  actionClass(type: string): string {
    switch (type) {
      case 'membership_created': return 'created';
      case 'membership_updated': return 'updated';
      case 'membership_deleted': return 'deleted';
      case 'attendance_recorded': return 'attendance';
      default: return 'other';
    }
  }

  membershipTypeLabel(type: string): string {
    switch (type) {
      case 'kombinalt': return 'Kombinált';
      case 'kempo_cross': return 'Kempo, cross';
      case 'session_pass': return 'Alkalmi';
      default: return type;
    }
  }
}

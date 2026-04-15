import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as XLSX from 'xlsx';
import { SupabaseService } from '../../services/supabase.service';

const HU_MONTHS = ['jan.','feb.','már.','ápr.','máj.','jún.','júl.','aug.','szept.','okt.','nov.','dec.'];

interface AuditLogRow {
  id: string;
  created_at: string;
  action_type: string;
  membership_type: string | null;
  target_membership_id: string | null;
  details: any;
  profiles?: { full_name: string };
  target_profile?: { full_name: string };
}

interface MonthStat  { key: string; label: string; count: number; pct: number; }
interface AdminStat  { name: string; count: number; pct: number; }
interface TypeStat   { label: string; type: string; count: number; pct: number; }

interface PivotRow {
  adminName: string;
  months: number[];  // one slot per pivot month column
  total: number;
}

@Component({
  selector: 'app-audit-log',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './audit-log.component.html',
  styleUrl: './audit-log.component.scss',
})
export class AuditLogComponent implements OnInit {
  loading = true;
  activeTab: 'stats' | 'logs' | 'export' = 'stats';

  // Raw data
  logs: AuditLogRow[] = [];

  // KPI
  currentMonthCreated = 0;
  totalCreated = 0;
  totalUpdated = 0;
  totalDeleted = 0;
  totalAttendance = 0;
  totalRoleChanged = 0;

  // Charts / tables
  monthlyBerletStats: MonthStat[] = [];   // last 12 months
  adminBerletStats: AdminStat[] = [];
  actionTypeStats: TypeStat[] = [];
  membershipTypeStats: TypeStat[] = [];

  // Pivot: admin × month
  pivotMonthLabels: string[] = [];
  pivotMonthKeys: string[] = [];
  pivotRows: PivotRow[] = [];

  // Logs tab
  logFilter: 'all' | 'membership_created' | 'membership_updated' | 'membership_deleted' | 'attendance_recorded' | 'role_changed' = 'all';
  logDateFrom = '';
  logDateTo = '';
  logPage = 0;
  readonly PAGE_SIZE = 25;

  // Export state
  exporting: 'members' | 'memberships' | 'audit' | 'summary' | null = null;
  exportError = '';

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    // Load all logs (no limit) so stats can correctly exclude deleted memberships
    this.logs = (await this.supabase.getAdminActionLogs()) as AuditLogRow[];
    this.computeStats();
    this.loading = false;
  }

  // ── Computed ──────────────────────────────────────────────────────────

  get filteredLogs(): AuditLogRow[] {
    let list = this.logs;
    if (this.logFilter !== 'all') list = list.filter(l => l.action_type === this.logFilter);
    if (this.logDateFrom) list = list.filter(l => l.created_at >= this.logDateFrom);
    if (this.logDateTo)   list = list.filter(l => l.created_at <= this.logDateTo + 'T23:59:59');
    return list;
  }

  get pagedLogs(): AuditLogRow[] {
    const start = this.logPage * this.PAGE_SIZE;
    return this.filteredLogs.slice(start, start + this.PAGE_SIZE);
  }

  get totalLogPages(): number {
    return Math.ceil(this.filteredLogs.length / this.PAGE_SIZE);
  }

  resetLogPage() { this.logPage = 0; }

  // ── Stats computation ────────────────────────────────────────────────

  private computeStats() {
    // When a membership is deleted, PostgreSQL's ON DELETE SET NULL cascade
    // NULLs out target_membership_id on the corresponding create log.
    // So: create events with target_membership_id = null belong to deleted memberships.

    const creationByMonth = new Map<string, number>();
    const creationByAdmin = new Map<string, number>();
    const byType = new Map<string, number>();
    const byMembershipType = new Map<string, number>();

    for (const log of this.logs) {
      const type = log.action_type;
      byType.set(type, (byType.get(type) ?? 0) + 1);

      if (type === 'membership_created') {
        // Exclude creates for deleted memberships (target_membership_id NULLed by FK cascade)
        if (!log.target_membership_id) continue;

        const monthKey = log.created_at.slice(0, 7) + '-01'; // YYYY-MM-01
        creationByMonth.set(monthKey, (creationByMonth.get(monthKey) ?? 0) + 1);
        const adminName = log.profiles?.full_name ?? 'Ismeretlen';
        creationByAdmin.set(adminName, (creationByAdmin.get(adminName) ?? 0) + 1);
        if (log.membership_type) {
          byMembershipType.set(log.membership_type, (byMembershipType.get(log.membership_type) ?? 0) + 1);
        }
        this.totalCreated++;
      } else if (type === 'membership_updated')  this.totalUpdated++;
      else if (type === 'membership_deleted')    this.totalDeleted++;
      else if (type === 'attendance_recorded')   this.totalAttendance++;
      else if (type === 'role_changed')          this.totalRoleChanged++;
    }

    // ── Monthly bars (last 12 months) — excluding deleted memberships
    const now = new Date();
    const months: MonthStat[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 10);
      const label = `${d.getFullYear()}. ${HU_MONTHS[d.getMonth()]}`;
      months.push({ key, label, count: creationByMonth.get(key) ?? 0, pct: 0 });
    }
    this.currentMonthCreated = months[0]?.count ?? 0;
    const maxM = Math.max(...months.map(m => m.count), 1);
    for (const m of months) m.pct = (m.count / maxM) * 100;
    this.monthlyBerletStats = months;

    // ── Admin breakdown — excluding deleted memberships
    const adminList: AdminStat[] = Array.from(creationByAdmin.entries())
      .map(([name, count]) => ({ name, count, pct: 0 }))
      .sort((a, b) => b.count - a.count);
    const maxA = Math.max(...adminList.map(a => a.count), 1);
    for (const a of adminList) a.pct = (a.count / maxA) * 100;
    this.adminBerletStats = adminList;

    // ── Action type breakdown (all events, unfiltered)
    const typeTotal = Array.from(byType.values()).reduce((s, v) => s + v, 0) || 1;
    this.actionTypeStats = Array.from(byType.entries())
      .map(([type, count]) => ({ label: this.actionLabel(type), type, count, pct: Math.round(count / typeTotal * 100) }))
      .sort((a, b) => b.count - a.count);

    // ── Membership type breakdown — excluding deleted memberships
    const mtTotal = Array.from(byMembershipType.values()).reduce((s, v) => s + v, 0) || 1;
    this.membershipTypeStats = Array.from(byMembershipType.entries())
      .map(([type, count]) => ({ label: this.membershipTypeLabel(type), type, count, pct: Math.round(count / mtTotal * 100) }))
      .sort((a, b) => b.count - a.count);

    // ── Pivot table: admin × last 12 months — excluding deleted memberships
    this.pivotMonthKeys   = months.map(m => m.key);
    this.pivotMonthLabels = months.map(m => m.label);

    const pivotMap = new Map<string, number[]>(); // admin → count per month slot
    for (const log of this.logs) {
      if (log.action_type !== 'membership_created') continue;
      if (!log.target_membership_id) continue;
      const monthKey = log.created_at.slice(0, 7) + '-01';
      const slotIdx = this.pivotMonthKeys.indexOf(monthKey);
      if (slotIdx === -1) continue;
      const adminName = log.profiles?.full_name ?? 'Ismeretlen';
      if (!pivotMap.has(adminName)) pivotMap.set(adminName, new Array(12).fill(0));
      pivotMap.get(adminName)![slotIdx]++;
    }
    this.pivotRows = Array.from(pivotMap.entries())
      .map(([adminName, months]) => ({ adminName, months, total: months.reduce((s, v) => s + v, 0) }))
      .sort((a, b) => b.total - a.total);
  }

  // ── Export ───────────────────────────────────────────────────────────

  async exportMembers() {
    this.exporting = 'members';
    this.exportError = '';
    try {
      const data = await this.supabase.getAllMembersForExport();
      const rows = (data as any[]).map(p => ({
        'Név': p.full_name,
        'Öv fokozat': p.belt_rank ?? '',
        'Telefon': p.phone ?? '',
        'Születési dátum': p.birth_date ?? '',
        'Orvosi érvényessége': p.medical_validity ?? '',
        'Tagdíj fizetve': p.membership_fee_paid ? 'Igen' : 'Nem',
        'Szerepkör': p.admin_role ?? 'tanuló',
        'Regisztrálva': this.fmtDate(p.created_at),
      }));
      this.downloadExcel([{ name: 'Tagok', rows }], 'dhkse_tagok');
    } catch (e: any) {
      this.exportError = e?.message ?? 'Export hiba';
    } finally {
      this.exporting = null;
    }
  }

  async exportMemberships() {
    this.exporting = 'memberships';
    this.exportError = '';
    try {
      const data = await this.supabase.getAllMembershipsForExport();
      const rows = (data as any[]).map(m => ({
        'Tag neve': (m.profiles as any)?.full_name ?? '',
        'Bérlet típus': this.membershipTypeLabel(m.type),
        'Státusz': m.status,
        'Összes alkalom': m.total_sessions ?? '',
        'Maradék alkalom': m.remaining_sessions ?? '',
        'Érvényes eddig': m.valid_until ? new Date(m.valid_until).toLocaleDateString('hu-HU') : '',
        'Létrehozva': this.fmtDate(m.created_at),
        'Frissítve': this.fmtDate(m.updated_at),
      }));
      this.downloadExcel([{ name: 'Bérletek', rows }], 'dhkse_berletek');
    } catch (e: any) {
      this.exportError = e?.message ?? 'Export hiba';
    } finally {
      this.exporting = null;
    }
  }

  async exportAuditLogs() {
    this.exporting = 'audit';
    this.exportError = '';
    try {
      const data = await this.supabase.getAllAuditLogsForExport();
      const rows = (data as any[]).map(l => ({
        'Dátum': this.fmtDate(l.created_at),
        'Admin': (l.profiles as any)?.full_name ?? '',
        'Érintett tag': (l.target_profile as any)?.full_name ?? '',
        'Művelet': this.actionLabel(l.action_type),
        'Bérlet típus': l.membership_type ? this.membershipTypeLabel(l.membership_type) : '',
        'Részletek': JSON.stringify(l.details ?? {}),
      }));
      this.downloadExcel([{ name: 'Műveleti napló', rows }], 'dhkse_naplo');
    } catch (e: any) {
      this.exportError = e?.message ?? 'Export hiba';
    } finally {
      this.exporting = null;
    }
  }

  async exportMonthlySummary() {
    this.exporting = 'summary';
    this.exportError = '';
    try {
      // Pivot table: admin × month
      const pivotSheetRows: any[] = [];
      const headerRow: any = { 'Admin': 'Admin' };
      for (const lbl of this.pivotMonthLabels) headerRow[lbl] = lbl;
      headerRow['Összesen'] = 'Összesen';
      pivotSheetRows.push(headerRow);
      for (const row of this.pivotRows) {
        const r: any = { 'Admin': row.adminName };
        for (let i = 0; i < this.pivotMonthLabels.length; i++) r[this.pivotMonthLabels[i]] = row.months[i] || 0;
        r['Összesen'] = row.total;
        pivotSheetRows.push(r);
      }

      this.downloadExcel([
        { name: 'Admin pivot', rows: pivotSheetRows },
      ], 'dhkse_havi_osszesito');
    } catch (e: any) {
      this.exportError = e?.message ?? 'Export hiba';
    } finally {
      this.exporting = null;
    }
  }

  async exportAll() {
    this.exporting = 'summary';
    this.exportError = '';
    try {
      const [members, memberships, auditLogs] = await Promise.all([
        this.supabase.getAllMembersForExport(),
        this.supabase.getAllMembershipsForExport(),
        this.supabase.getAllAuditLogsForExport(),
      ]);

      const memberRows = (members as any[]).map(p => ({
        'Név': p.full_name,
        'Öv fokozat': p.belt_rank ?? '',
        'Telefon': p.phone ?? '',
        'Születési dátum': p.birth_date ?? '',
        'Orvosi érvényessége': p.medical_validity ?? '',
        'Tagdíj fizetve': p.membership_fee_paid ? 'Igen' : 'Nem',
        'Szerepkör': p.admin_role ?? 'tanuló',
        'Regisztrálva': this.fmtDate(p.created_at),
      }));

      const membershipRows = (memberships as any[]).map(m => ({
        'Tag neve': (m.profiles as any)?.full_name ?? '',
        'Bérlet típus': this.membershipTypeLabel(m.type),
        'Státusz': m.status,
        'Összes alkalom': m.total_sessions ?? '',
        'Maradék alkalom': m.remaining_sessions ?? '',
        'Érvényes eddig': m.valid_until ? new Date(m.valid_until).toLocaleDateString('hu-HU') : '',
        'Létrehozva': this.fmtDate(m.created_at),
      }));

      const auditRows = (auditLogs as any[]).map(l => ({
        'Dátum': this.fmtDate(l.created_at),
        'Admin': (l.profiles as any)?.full_name ?? '',
        'Érintett tag': (l.target_profile as any)?.full_name ?? '',
        'Művelet': this.actionLabel(l.action_type),
        'Bérlet típus': l.membership_type ? this.membershipTypeLabel(l.membership_type) : '',
        'Részletek': JSON.stringify(l.details ?? {}),
      }));

      const pivotSheetRows: any[] = [];
      const headerRow: any = { 'Admin': 'Admin' };
      for (const lbl of this.pivotMonthLabels) headerRow[lbl] = lbl;
      headerRow['Összesen'] = 'Összesen';
      pivotSheetRows.push(headerRow);
      for (const row of this.pivotRows) {
        const r: any = { 'Admin': row.adminName };
        for (let i = 0; i < this.pivotMonthLabels.length; i++) r[this.pivotMonthLabels[i]] = row.months[i] || 0;
        r['Összesen'] = row.total;
        pivotSheetRows.push(r);
      }

      this.downloadExcel([
        { name: 'Tagok', rows: memberRows },
        { name: 'Bérletek', rows: membershipRows },
        { name: 'Műveleti napló', rows: auditRows },
        { name: 'Admin pivot', rows: pivotSheetRows },
      ], 'dhkse_teljes_export');
    } catch (e: any) {
      this.exportError = e?.message ?? 'Export hiba';
    } finally {
      this.exporting = null;
    }
  }

  private downloadExcel(sheets: { name: string; rows: any[] }[], filename: string) {
    const wb = XLSX.utils.book_new();
    for (const s of sheets) {
      const ws = XLSX.utils.json_to_sheet(s.rows);
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    }
    XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  fmtDate(value: string): string {
    if (!value) return '';
    return new Date(value).toLocaleString('hu-HU');
  }

  actionIcon(type: string): string {
    switch (type) {
      case 'membership_created':  return 'add_circle';
      case 'membership_updated':  return 'edit';
      case 'membership_deleted':  return 'delete';
      case 'attendance_recorded': return 'how_to_reg';
      case 'role_changed':        return 'admin_panel_settings';
      default: return 'info';
    }
  }

  actionLabel(type: string): string {
    switch (type) {
      case 'membership_created':  return 'Bérlet létrehozva';
      case 'membership_updated':  return 'Bérlet módosítva';
      case 'membership_deleted':  return 'Bérlet törölve';
      case 'attendance_recorded': return 'Jelenlét rögzítve';
      case 'role_changed':        return 'Jogosultság módosítva';
      default: return type;
    }
  }

  actionClass(type: string): string {
    switch (type) {
      case 'membership_created':  return 'created';
      case 'membership_updated':  return 'updated';
      case 'membership_deleted':  return 'deleted';
      case 'attendance_recorded': return 'attendance';
      case 'role_changed':        return 'role';
      default: return 'other';
    }
  }

  membershipTypeLabel(type: string): string {
    switch (type) {
      case 'kombinalt':    return 'Kombinált';
      case 'kempo_cross':  return 'Kempo, cross';
      case 'session_pass': return 'Alkalmi';
      default: return type ?? '';
    }
  }

  typeColor(type: string): string {
    switch (type) {
      case 'membership_created':  return '#4a6cf7';
      case 'membership_updated':  return '#f7a94a';
      case 'membership_deleted':  return '#f75a5a';
      case 'attendance_recorded': return '#4af77a';
      case 'role_changed':        return '#a94af7';
      default: return '#888';
    }
  }
}

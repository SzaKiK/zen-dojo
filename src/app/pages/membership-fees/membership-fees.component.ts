import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import * as XLSX from 'xlsx';
import { MembershipFeeSeason, Profile, SupabaseService } from '../../services/supabase.service';

interface FeeSeason {
  startYear: number;
  label: string;
  current: boolean;
}

interface FeeMember {
  id: string;
  full_name: string;
  belt_rank: string | null;
  is_disabled?: boolean;
  paidBySeason: Record<number, boolean>;
}

type PaymentFilter = 'all' | 'paid' | 'unpaid';

@Component({
  selector: 'app-membership-fees',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './membership-fees.component.html',
  styleUrl: './membership-fees.component.scss',
})
export class MembershipFeesComponent implements OnInit {
  readonly seasons = this.buildSeasons();
  selectedSeasonStartYear = this.seasons.find(season => season.current)!.startYear;
  paymentFilter: PaymentFilter = 'all';
  searchText = '';
  members: FeeMember[] = [];
  loading = true;
  exporting = false;
  errorMessage = '';

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const [profiles, seasonRows] = await Promise.all([
      this.supabase.getAllProfiles(),
      this.supabase.getAllMembershipFeeSeasons(this.seasons.map(season => season.startYear)),
    ]);
    const seasonsByMember = new Map<string, Map<number, boolean>>();
    for (const row of seasonRows as MembershipFeeSeason[]) {
      if (!seasonsByMember.has(row.user_id)) seasonsByMember.set(row.user_id, new Map());
      seasonsByMember.get(row.user_id)!.set(row.season_start_year, row.paid);
    }

    this.members = profiles.map((profile: Profile) => {
      const savedPayments = seasonsByMember.get(profile.id);
      const paidBySeason: Record<number, boolean> = {};
      for (const season of this.seasons) {
        paidBySeason[season.startYear] = savedPayments?.has(season.startYear)
          ? savedPayments.get(season.startYear)!
          : season.current && !!profile.membership_fee_paid;
      }
      return {
        id: profile.id,
        full_name: profile.full_name,
        belt_rank: profile.belt_rank,
        is_disabled: profile.is_disabled,
        paidBySeason,
      };
    });
    this.loading = false;
  }

  get selectedSeason(): FeeSeason {
    return this.seasons.find(season => season.startYear === this.selectedSeasonStartYear)!;
  }

  get paidCount(): number {
    return this.members.filter(member => member.paidBySeason[this.selectedSeasonStartYear]).length;
  }

  get unpaidCount(): number {
    return this.members.length - this.paidCount;
  }

  paidCountForSeason(seasonStartYear: number): number {
    return this.members.filter(member => member.paidBySeason[seasonStartYear]).length;
  }

  get paidPercent(): number {
    return this.members.length ? Math.round((this.paidCount / this.members.length) * 100) : 0;
  }

  get filteredMembers(): FeeMember[] {
    const normalizedSearch = this.searchText.trim().toLocaleLowerCase('hu-HU');
    return this.members.filter(member => {
      const paid = member.paidBySeason[this.selectedSeasonStartYear];
      const matchesStatus = this.paymentFilter === 'all'
        || (this.paymentFilter === 'paid' && paid)
        || (this.paymentFilter === 'unpaid' && !paid);
      const matchesSearch = !normalizedSearch
        || member.full_name.toLocaleLowerCase('hu-HU').includes(normalizedSearch)
        || (member.belt_rank ?? '').toLocaleLowerCase('hu-HU').includes(normalizedSearch);
      return matchesStatus && matchesSearch;
    });
  }

  selectSeason(season: FeeSeason) {
    this.selectedSeasonStartYear = season.startYear;
    this.paymentFilter = 'all';
  }

  exportSeasonsToExcel() {
    if (this.exporting || this.members.length === 0) return;
    this.exporting = true;
    this.errorMessage = '';

    try {
      const detailRows = this.members.map(member => {
        const row: Record<string, string> = {
          'Tag neve': member.full_name,
          'Öv fokozat': member.belt_rank ?? '',
          'Fiók státusz': member.is_disabled ? 'Inaktív' : 'Aktív',
        };
        for (const season of this.seasons) {
          row[season.label] = member.paidBySeason[season.startYear] ? 'Fizetve' : 'Nem fizetve';
        }
        return row;
      });
      const summaryRows = this.seasons.map(season => {
        const paid = this.members.filter(member => member.paidBySeason[season.startYear]).length;
        return {
          Szezon: season.label,
          'Összes tag': this.members.length,
          'Fizetve': paid,
          'Nem fizetve': this.members.length - paid,
          'Fizetési arány': `${this.members.length ? Math.round((paid / this.members.length) * 100) : 0}%`,
          'Aktuális szezon': season.current ? 'Igen' : 'Nem',
        };
      });

      const workbook = XLSX.utils.book_new();
      const detailsSheet = XLSX.utils.json_to_sheet(detailRows);
      detailsSheet['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 16 }, ...this.seasons.map(() => ({ wch: 16 }))];
      const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
      summarySheet['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Szezon összesítő');
      XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Tagonként');
      XLSX.writeFile(workbook, `dhkse_tagdij_szezonok_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : 'Az Excel export nem sikerült.';
    } finally {
      this.exporting = false;
    }
  }

  private buildSeasons(): FeeSeason[] {
    const now = new Date();
    const currentStartYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return [-1, 0, 1].map(offset => {
      const startYear = currentStartYear + offset;
      return { startYear, label: `${startYear}/${startYear + 1}`, current: offset === 0 };
    });
  }
}
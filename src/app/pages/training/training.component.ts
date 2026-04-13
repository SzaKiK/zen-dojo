import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService, TrainingSession } from '../../services/supabase.service';

interface DisplaySession extends TrainingSession {
  time: string;
  levelClass: string;
  dojo: string;
  dayName: string;
  nextDateIso: string;
  nextDateLabel: string;
}

const DAY_MAP: Record<number, string> = {
  1: 'Hétfő',
  2: 'Kedd',
  3: 'Szerda',
  4: 'Csütörtök',
  5: 'Péntek',
  6: 'Szombat',
  7: 'Vasárnap',
};

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './training.component.html',
  styleUrl: './training.component.scss',
})
export class TrainingComponent implements OnInit {
  selectedDay = 1;
  days: { id: number; label: string; nextDateLabel: string }[] = [];
  allSessions: Record<number, DisplaySession[]> = {};
  loading = true;
  isAdmin = false;
  isFullAdmin = false;

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      const profile = await this.supabase.getProfile(data.session.user.id);
      this.isAdmin = this.supabase.isMembershipAdmin(profile);
      this.isFullAdmin = this.supabase.isFullAdmin(profile);
    }

    const dbSessions = await this.supabase.getTrainingSessions();

    if (dbSessions.length > 0) {
      const grouped: Record<number, DisplaySession[]> = {};
      for (const s of dbSessions) {
        const startStr = s.start_time.substring(0, 5);
        const endStr = s.end_time.substring(0, 5);
        const nextDate = this.getNextOccurrenceDate(s.day_of_week);
        const ds: DisplaySession = {
          ...s,
          time: `${startStr} - ${endStr}`,
          levelClass: this.getLevelClass(s.level),
          dojo: this.getDojo(s),
          dayName: DAY_MAP[s.day_of_week] ?? `Nap ${s.day_of_week}`,
          nextDateIso: nextDate,
          nextDateLabel: this.formatDateLabel(nextDate),
        };
        (grouped[s.day_of_week] ??= []).push(ds);
      }
      this.allSessions = grouped;
    } else {
      this.loadFallbackSessions();
    }

    this.days = Object.keys(this.allSessions)
      .map((d) => Number(d))
      .sort((a, b) => a - b)
      .map((dayId) => ({
        id: dayId,
        label: DAY_MAP[dayId] ?? `Nap ${dayId}`,
        nextDateLabel: this.formatDateLabel(this.getNextOccurrenceDate(dayId)),
      }));

    if (this.days.length > 0 && !this.days.some((d) => d.id === this.selectedDay)) {
      this.selectedDay = this.days[0].id;
    }

    this.loading = false;
  }

  get sessions() {
    return this.allSessions[this.selectedDay] ?? [];
  }

  selectDay(day: number) {
    this.selectedDay = day;
  }

  /** Returns the YYYY-MM-DD of the next occurrence of dayOfWeek (1=Mon…7=Sun, ISO). */
  getNextOccurrenceDate(dayOfWeek: number): string {
    const today = new Date();
    const todayDow = today.getDay() === 0 ? 7 : today.getDay(); // 1=Mon…7=Sun
    let daysUntil = dayOfWeek - todayDow;
    if (daysUntil < 0) daysUntil += 7;
    const next = new Date(today);
    next.setDate(today.getDate() + daysUntil);
    return next.toISOString().split('T')[0];
  }

  get headerRoute(): string {
    return this.isFullAdmin ? '/admin' : this.isAdmin ? '/berletek' : '/membership-card';
  }

  private formatDateLabel(dateIso: string): string {
    const d = new Date(`${dateIso}T00:00:00`);
    return d.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' });
  }

  private getLevelClass(level: string): string {
    const l = level.toLowerCase();
    if (l.includes('versenyző')) return 'advanced';
    if (l.includes('kezdő')) return 'beginner';
    if (l.includes('gyerek') && !l.includes('felnőtt')) return 'kids';
    return 'all';
  }

  private getDojo(session: TrainingSession): string {
    if (session.location) return session.location;
    return session.instructor_name.includes('Rácz') ? 'Senshi Usagi, Tabajd' : 'Dojo Metzger, Bicske';
  }

  private loadFallbackSessions() {
    const fallback = [
      { time: '18:00 - 19:30', title: 'Kempo', instructor_name: 'Shihan Metzger Antal', level: 'Gyerek és felnőtt', capacity: 25, current_bookings: 13, day: 'Hétfő', dojo: 'Dojo Metzger, Bicske' },
      { time: '18:00 - 19:00', title: 'Cross Fitness', instructor_name: 'Shihan Metzger Antal', level: 'Összes szint', capacity: 20, current_bookings: 10, day: 'Kedd', dojo: 'Dojo Metzger, Bicske' },
      { time: '19:00 - 20:00', title: 'Kempo Versenyző', instructor_name: 'Sensei Farkas Zoltán', level: 'Versenyző', capacity: 15, current_bookings: 7, day: 'Kedd', dojo: 'Dojo Metzger, Bicske' },
      { time: '18:15 - 19:30', title: 'Kempo', instructor_name: 'Sensei Rácz Richárd', level: 'Gyerek és felnőtt', capacity: 20, current_bookings: 10, day: 'Kedd', dojo: 'Senshi Usagi, Tabajd' },
      { time: '18:00 - 19:30', title: 'Kempo Kezdő', instructor_name: 'Shihan Metzger Antal', level: 'Gyerek és kezdő felnőtt', capacity: 25, current_bookings: 10, day: 'Csütörtök', dojo: 'Dojo Metzger, Bicske' },
      { time: '17:30 - 19:00', title: 'Kempo', instructor_name: 'Sensei Rácz Richárd', level: 'Gyerek és felnőtt', capacity: 20, current_bookings: 10, day: 'Péntek', dojo: 'Senshi Usagi, Tabajd' },
    ];
    for (const fb of fallback) {
      const dayOfWeek = Object.entries(DAY_MAP).find(([, v]) => v === fb.day)?.[0];
      const dayId = dayOfWeek ? Number(dayOfWeek) : 1;
      const nextDate = this.getNextOccurrenceDate(dayId);
      const ds: DisplaySession = {
        id: '', title: fb.title, instructor_name: fb.instructor_name, level: fb.level,
        day_of_week: dayId, start_time: '', end_time: '', capacity: fb.capacity,
        current_bookings: fb.current_bookings, created_at: '', time: fb.time,
        levelClass: this.getLevelClass(fb.level), dojo: fb.dojo,
        dayName: fb.day,
        nextDateIso: nextDate,
        nextDateLabel: this.formatDateLabel(nextDate),
      };
      (this.allSessions[dayId] ??= []).push(ds);
    }
  }
}

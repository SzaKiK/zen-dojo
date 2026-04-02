import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, TrainingSession } from '../../services/supabase.service';

interface DisplaySession extends TrainingSession {
  time: string;
  levelClass: string;
  dojo: string;
  booked: boolean;
  booking: boolean;
  full: boolean;
}

const DAY_MAP: Record<number, string> = { 1: 'Hétfő', 2: 'Kedd', 4: 'Csütörtök', 5: 'Péntek' };
const DAY_ORDER = ['Hétfő', 'Kedd', 'Csütörtök', 'Péntek'];

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './training.component.html',
  styleUrl: './training.component.scss',
})
export class TrainingComponent implements OnInit {
  selectedDay = 'Hétfő';
  days = DAY_ORDER;
  allSessions: Record<string, DisplaySession[]> = {};
  loading = true;
  feedbackMsg = '';
  feedbackType: 'success' | 'error' = 'success';

  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit() {
    const dbSessions = await this.supabase.getTrainingSessions();

    if (dbSessions.length > 0) {
      const grouped: Record<string, DisplaySession[]> = {};
      for (const s of dbSessions) {
        const dayName = DAY_MAP[s.day_of_week] ?? `Nap ${s.day_of_week}`;
        const startStr = s.start_time.substring(0, 5);
        const endStr = s.end_time.substring(0, 5);
        const spots = s.capacity - s.current_bookings;
        const ds: DisplaySession = {
          ...s,
          time: `${startStr} - ${endStr}`,
          levelClass: this.getLevelClass(s.level),
          dojo: s.instructor_name.includes('Rácz') ? 'Senshi Usagi, Tabajd' : 'Dojo Metzger, Bicske',
          booked: false,
          booking: false,
          full: spots <= 0,
        };
        (grouped[dayName] ??= []).push(ds);
      }
      this.allSessions = grouped;
    } else {
      this.loadFallbackSessions();
    }
    this.loading = false;
  }

  get sessions() {
    return this.allSessions[this.selectedDay] ?? [];
  }

  selectDay(day: string) {
    this.selectedDay = day;
  }

  async bookSession(session: DisplaySession) {
    if (session.booked || session.booking || session.full) return;
    session.booking = true;
    this.feedbackMsg = '';

    const result = await this.supabase.bookSession(session.id);
    session.booking = false;

    if (result && !(result as any).error) {
      session.booked = true;
      session.current_bookings++;
      session.full = session.current_bookings >= session.capacity;
      this.showFeedback('Sikeresen foglaltál!', 'success');
    } else {
      this.showFeedback('Hiba a foglalásnál. Próbáld újra.', 'error');
    }
  }

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }

  private showFeedback(msg: string, type: 'success' | 'error') {
    this.feedbackMsg = msg;
    this.feedbackType = type;
    setTimeout(() => (this.feedbackMsg = ''), 3000);
  }

  private getLevelClass(level: string): string {
    const l = level.toLowerCase();
    if (l.includes('versenyző')) return 'advanced';
    if (l.includes('kezdő')) return 'beginner';
    if (l.includes('gyerek') && !l.includes('felnőtt')) return 'kids';
    return 'all';
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
      const ds: DisplaySession = {
        id: '', title: fb.title, instructor_name: fb.instructor_name, level: fb.level,
        day_of_week: 0, start_time: '', end_time: '', capacity: fb.capacity,
        current_bookings: fb.current_bookings, created_at: '', time: fb.time,
        levelClass: this.getLevelClass(fb.level), dojo: fb.dojo,
        booked: false, booking: false, full: false,
      };
      (this.allSessions[fb.day] ??= []).push(ds);
    }
  }
}

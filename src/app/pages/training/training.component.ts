import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, TrainingSession, UserBooking } from '../../services/supabase.service';

interface DisplaySession extends TrainingSession {
  time: string;
  levelClass: string;
  dojo: string;
  booked: boolean;
  bookedDate: string;
  booking: boolean;
  cancelling: boolean;
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
  isAdmin = false;
  currentUserId = '';
  upcomingBookings: UserBooking[] = [];
  showSubscriptions = false;

  constructor(private supabase: SupabaseService, private router: Router) {}

  async ngOnInit() {
    const { data } = await this.supabase.getSession();
    if (data?.session?.user) {
      this.currentUserId = data.session.user.id;
      const profile = await this.supabase.getProfile(data.session.user.id);
      this.isAdmin = profile?.is_admin ?? false;
    }

    const dbSessions = await this.supabase.getTrainingSessions();

    // Load user's upcoming bookings
    const upcomingBookings = this.currentUserId
      ? await this.supabase.getUserUpcomingBookings(this.currentUserId)
      : [];
    this.upcomingBookings = upcomingBookings;
    const bookedSessionIds = new Set(upcomingBookings.map(b => b.session_id));

    if (dbSessions.length > 0) {
      const grouped: Record<string, DisplaySession[]> = {};
      for (const s of dbSessions) {
        const dayName = DAY_MAP[s.day_of_week] ?? `Nap ${s.day_of_week}`;
        const startStr = s.start_time.substring(0, 5);
        const endStr = s.end_time.substring(0, 5);
        const spots = s.capacity - s.current_bookings;
      for (const s of dbSessions) {
        const dayName = DAY_MAP[s.day_of_week] ?? `Nap ${s.day_of_week}`;
        const startStr = s.start_time.substring(0, 5);
        const endStr = s.end_time.substring(0, 5);
        const spots = s.capacity - s.current_bookings;
        const nextDate = this.getNextOccurrenceDate(s.day_of_week);
        const existingBooking = upcomingBookings.find(b => b.session_id === s.id);
        const ds: DisplaySession = {
          ...s,
          time: `${startStr} - ${endStr}`,
          levelClass: this.getLevelClass(s.level),
          dojo: s.instructor_name.includes('Rácz') ? 'Senshi Usagi, Tabajd' : 'Dojo Metzger, Bicske',
          booked: bookedSessionIds.has(s.id),
          bookedDate: existingBooking?.booking_date ?? nextDate,
          booking: false,
          cancelling: false,
          full: spots <= 0,
        };
        (grouped[dayName] ??= []).push(ds);
      }
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
    if (session.booked || session.booking || session.full || this.isAdmin) return;
    session.booking = true;
    this.feedbackMsg = '';

    const bookingDate = this.getNextOccurrenceDate(session.day_of_week);
    const result = await this.supabase.bookSession(session.id, this.currentUserId, bookingDate);
    session.booking = false;

    if (result && !result.error) {
      session.booked = true;
      session.bookedDate = bookingDate;
      session.current_bookings++;
      session.full = session.current_bookings >= session.capacity;
      this.upcomingBookings = await this.supabase.getUserUpcomingBookings(this.currentUserId);
      this.showFeedback('Sikeresen foglaltál!', 'success');
    } else {
      this.showFeedback(result?.error?.message ?? 'Hiba a foglalásnál. Próbáld újra.', 'error');
    }
  }

  async cancelSession(session: DisplaySession) {
    if (!session.booked || session.cancelling) return;
    session.cancelling = true;
    this.feedbackMsg = '';

    const result = await this.supabase.cancelBooking(session.id, this.currentUserId, session.bookedDate);
    session.cancelling = false;

    if (result && !result.error) {
      session.booked = false;
      session.current_bookings = Math.max(0, session.current_bookings - 1);
      session.full = false;
      this.upcomingBookings = this.upcomingBookings.filter(b => b.session_id !== session.id);
      this.showFeedback('Foglalás lemondva.', 'success');
    } else {
      this.showFeedback(result?.error?.message ?? 'Hiba a lemondásnál.', 'error');
    }
  }

  async cancelBookingById(booking: UserBooking) {
    const result = await this.supabase.cancelBooking(booking.session_id, this.currentUserId, booking.booking_date);
    if (result && !result.error) {
      this.upcomingBookings = this.upcomingBookings.filter(b => b.booking_id !== booking.booking_id);
      // Update session booked state
      for (const sessions of Object.values(this.allSessions)) {
        const s = sessions.find(s => s.id === booking.session_id);
        if (s) {
          s.booked = false;
          s.current_bookings = Math.max(0, s.current_bookings - 1);
          s.full = false;
        }
      }
      this.showFeedback('Foglalás lemondva.', 'success');
    } else {
      this.showFeedback(result?.error?.message ?? 'Hiba a lemondásnál.', 'error');
    }
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

  bookingDayLabel(booking: UserBooking): string {
    const d = new Date(booking.booking_date + 'T00:00:00');
    return d.toLocaleDateString('hu-HU', { weekday: 'long', month: 'long', day: 'numeric' });
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
        booked: false, bookedDate: '', booking: false, cancelling: false, full: false,
      };
      (this.allSessions[fb.day] ??= []).push(ds);
    }
  }
}

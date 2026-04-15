import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SupabaseService, TrainingSession } from '../../services/supabase.service';

const DAYS = ['Vasárnap', 'Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];

type FormData = Omit<TrainingSession, 'id' | 'created_at' | 'current_bookings'>;

const emptyForm = (): FormData => ({
  title: '',
  instructor_name: '',
  location: '',
  level: 'all',
  day_of_week: 1,
  start_time: '18:00',
  end_time: '19:30',
  capacity: 20,
});

@Component({
  selector: 'app-session-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './session-manager.component.html',
  styleUrl: './session-manager.component.scss',
})
export class SessionManagerComponent implements OnInit {
  sessions: TrainingSession[] = [];
  loading = true;
  error = '';

  // Modal state
  showModal = false;
  editingId: string | null = null;
  saving = false;
  modalError = '';
  form: FormData = emptyForm();

  // Delete confirm
  deletingId: string | null = null;
  deleteConfirmId: string | null = null;

  readonly days = DAYS;
  readonly levels = [
    { value: 'all', label: 'Minden szint' },
    { value: 'beginner', label: 'Kezdő' },
    { value: 'intermediate', label: 'Haladó' },
    { value: 'advanced', label: 'Versenyző' },
  ];

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    await this.loadSessions();
  }

  async loadSessions() {
    this.loading = true;
    try {
      this.sessions = await this.supabase.getTrainingSessions();
    } catch {
      this.error = 'Nem sikerült betölteni az edzéseket.';
    } finally {
      this.loading = false;
    }
  }

  // Group sessions by day for display
  get sessionsByDay(): { day: number; label: string; sessions: TrainingSession[] }[] {
    const map = new Map<number, TrainingSession[]>();
    for (const s of this.sessions) {
      if (!map.has(s.day_of_week)) map.set(s.day_of_week, []);
      map.get(s.day_of_week)!.push(s);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([day, sessions]) => ({ day, label: DAYS[day] ?? `Nap ${day}`, sessions }));
  }

  openAdd() {
    this.editingId = null;
    this.form = emptyForm();
    this.modalError = '';
    this.showModal = true;
  }

  openEdit(s: TrainingSession) {
    this.editingId = s.id;
    this.form = {
      title: s.title,
      instructor_name: s.instructor_name,
      location: s.location ?? '',
      level: s.level,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      capacity: s.capacity,
    };
    this.modalError = '';
    this.showModal = true;
  }

  closeModal() {
    this.showModal = false;
    this.editingId = null;
  }

  async save() {
    if (!this.form.title.trim() || !this.form.instructor_name.trim()) {
      this.modalError = 'A megnevezés és az edző neve kötelező.';
      return;
    }
    if (this.form.start_time >= this.form.end_time) {
      this.modalError = 'A kezdési időpont korábban kell legyen, mint a befejezési.';
      return;
    }
    this.saving = true;
    this.modalError = '';
    try {
      const payload = { ...this.form, location: this.form.location || null };
      if (this.editingId) {
        const { error } = await this.supabase.updateTrainingSession(this.editingId, payload);
        if (error) throw error;
        const idx = this.sessions.findIndex(s => s.id === this.editingId);
        if (idx !== -1) this.sessions[idx] = { ...this.sessions[idx], ...payload };
      } else {
        const { data, error } = await this.supabase.createTrainingSession(payload);
        if (error) throw error;
        if (data) this.sessions = [...this.sessions, data];
      }
      this.closeModal();
    } catch (e: any) {
      this.modalError = e?.message || 'Hiba történt a mentés során.';
    } finally {
      this.saving = false;
    }
  }

  confirmDelete(id: string) {
    this.deleteConfirmId = id;
  }

  cancelDelete() {
    this.deleteConfirmId = null;
  }

  async deleteSession(id: string) {
    this.deletingId = id;
    try {
      const { error } = await this.supabase.deleteTrainingSession(id);
      if (error) throw error;
      this.sessions = this.sessions.filter(s => s.id !== id);
    } catch (e: any) {
      this.error = e?.message || 'Hiba történt a törlés során.';
    } finally {
      this.deletingId = null;
      this.deleteConfirmId = null;
    }
  }

  levelLabel(value: string): string {
    return this.levels.find(l => l.value === value)?.label ?? value;
  }

  dayLabel(day: number): string {
    return DAYS[day] ?? `Nap ${day}`;
  }

  formatTime(t: string): string {
    return t?.slice(0, 5) ?? '';
  }
}

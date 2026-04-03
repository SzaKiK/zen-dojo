import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

// Kyu: 9.kyu (beginner) → 1.kyu; Dan: 1.dan → 10.dan
export const BELT_RANKS = [
  '9.kyu','8.kyu','7.kyu','6.kyu','5.kyu','4.kyu','3.kyu','2.kyu','1.kyu',
  '1.dan','2.dan','3.dan','4.dan','5.dan','6.dan','7.dan','8.dan','9.dan','10.dan',
];

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  belt_rank: string | null;
  qr_code_id: string;
  is_admin: boolean;
  birth_date: string | null;
  // Admin-only fields:
  medical_validity: string | null;   // Sportorvosi érvényesség
  membership_fee_paid: boolean;      // Éves tagsági díj
}

export interface BeltExam {
  id: string;
  user_id: string;
  exam_date: string;
  belt_rank: string;
  created_at: string;
}

export interface TrainingCamp {
  id: string;
  user_id: string;
  camp_date: string;
  description: string;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  type: string;
  total_sessions: number;
  remaining_sessions: number;
  valid_until: string;
  status: 'active' | 'expired' | 'pending';
}

export interface TrainingSession {
  id: string;
  title: string;
  instructor_name: string;
  level: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  capacity: number;
  current_bookings: number;
  created_at: string;
}

export interface UserBooking {
  booking_id: string;
  session_id: string;
  booking_date: string;
  checked_in: boolean;
  session_title: string;
  instructor: string;
  start_time: string;
  end_time: string;
  day_of_week: number;
  level: string;
}

export interface SessionSubscriber {
  user_id: string;
  full_name: string;
  belt_rank: string | null;
  avatar_url: string;
  appeared: boolean;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private supabase: SupabaseClient | null = null;

  get isMockMode(): boolean {
    return !environment.supabaseUrl || environment.supabaseUrl === 'YOUR_SUPABASE_URL';
  }

  constructor() {
    if (!this.isMockMode) {
      this.supabase = createClient(
        environment.supabaseUrl,
        environment.supabaseKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            lock: <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
          },
        }
      );
    }
  }

  get client() {
    return this.supabase;
  }

  // Auth
  signIn(email: string, password: string) {
    if (this.isMockMode) return Promise.resolve({ data: { session: { user: { id: 'mock' } } }, error: null } as any);
    return this.supabase!.auth.signInWithPassword({ email, password });
  }

  signUp(email: string, password: string, fullName: string, birthDate?: string) {
    if (this.isMockMode) return Promise.resolve({ data: {}, error: null } as any);
    return this.supabase!.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, birth_date: birthDate ?? null } }
    });
  }

  signOut() {
    if (this.isMockMode) return Promise.resolve({ error: null });
    return this.supabase!.auth.signOut();
  }

  getSession() {
    if (this.isMockMode) return Promise.resolve({ data: { session: null }, error: null } as any);
    return this.supabase!.auth.getSession();
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    if (this.isMockMode) return { data: { subscription: { unsubscribe: () => {} } } };
    return this.supabase!.auth.onAuthStateChange(callback);
  }

  async getProfile(userId: string): Promise<Profile | null> {
    if (this.isMockMode) return null;
    const { data } = await this.supabase!
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    return data;
  }

  async getProfileByQR(qrCodeId: string): Promise<Profile | null> {
    if (this.isMockMode) return null;
    const { data } = await this.supabase!
      .from('profiles')
      .select('*')
      .eq('qr_code_id', qrCodeId)
      .maybeSingle();
    return data;
  }

  async getAllProfiles(): Promise<Profile[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('profiles')
      .select('*')
      .order('full_name');
    return data ?? [];
  }

  async getMembership(userId: string): Promise<Membership | null> {
    if (this.isMockMode) return null;
    const { data } = await this.supabase!
      .from('memberships')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async updateMembership(id: string, updates: Partial<Membership>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('memberships').update(updates).eq('id', id);
  }

  async getTrainingSessions(): Promise<TrainingSession[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('training_sessions')
      .select('*')
      .order('day_of_week')
      .order('start_time');
    return data ?? [];
  }

  async bookSession(sessionId: string, userId: string, bookingDate?: string) {
    if (this.isMockMode) return { error: null };

    const { data, error } = await this.supabase!.rpc('book_training_session', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_booking_date: bookingDate ?? new Date().toISOString().split('T')[0],
    });

    if (error) return { error: { message: error.message } };
    if (data?.error) return { error: { message: data.error } };
    return { error: null };
  }

  async cancelBooking(sessionId: string, userId: string, bookingDate: string) {
    if (this.isMockMode) return { error: null };
    const { data, error } = await this.supabase!.rpc('cancel_booking', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_booking_date: bookingDate,
    });
    if (error) return { error: { message: error.message } };
    if (data?.error) return { error: { message: data.error } };
    return { error: null };
  }

  async getUserBookingsForDate(userId: string, date: string): Promise<string[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('bookings')
      .select('session_id')
      .eq('user_id', userId)
      .eq('booking_date', date);
    return (data ?? []).map((b: any) => b.session_id);
  }

  async getUserUpcomingBookings(userId: string): Promise<UserBooking[]> {
    if (this.isMockMode) return [];
    const { data, error } = await this.supabase!.rpc('get_user_bookings', { p_user_id: userId });
    if (error) return [];
    return (data as UserBooking[]) ?? [];
  }

  async getSessionSubscribers(sessionId: string, bookingDate: string): Promise<SessionSubscriber[]> {
    if (this.isMockMode) return [];
    const { data, error } = await this.supabase!.rpc('get_session_subscribers', {
      p_session_id: sessionId,
      p_booking_date: bookingDate,
    });
    if (error) return [];
    return (data as SessionSubscriber[]) ?? [];
  }

  async logEventAttendance(adminId: string, userId: string, sessionId: string) {
    if (this.isMockMode) return { error: null };
    const { data, error } = await this.supabase!.rpc('log_event_attendance', {
      p_admin_id: adminId,
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) return { error: { message: error.message } };
    if (data?.error) return { error: { message: data.error } };
    return { error: null };
  }

  // Bérletek (Memberships/Passes)
  async getAllMemberships(): Promise<(Membership & { profile?: Profile })[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('memberships')
      .select('*, profiles(full_name, belt_rank)')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async createMembership(membership: Omit<Membership, 'id'>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('memberships').insert(membership);
  }

  async deleteMembership(id: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('memberships').delete().eq('id', id);
  }

  async decrementSession(membershipId: string, currentRemaining: number) {
    if (this.isMockMode) return { error: null };
    return this.supabase!
      .from('memberships')
      .update({ remaining_sessions: currentRemaining - 1 })
      .eq('id', membershipId);
  }

  async setMembershipSessions(membershipId: string, remaining: number) {
    if (this.isMockMode) return { error: null };
    return this.supabase!
      .from('memberships')
      .update({ remaining_sessions: remaining })
      .eq('id', membershipId);
  }

  // Attendance / Check-in
  async logAttendance(userId: string, sessionId?: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('attendance_log').insert({
      user_id: userId,
      session_id: sessionId ?? null,
    });
  }

  async getRecentAttendance(limit = 20) {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('attendance_log')
      .select('*, profiles(full_name, belt_rank, avatar_url)')
      .order('checked_in_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  async getUserAttendance(userId: string, limit = 5) {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('attendance_log')
      .select('*, training_sessions(title)')
      .eq('user_id', userId)
      .order('checked_in_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  async getAttendanceStats() {
    if (this.isMockMode) return { total: 0, today: 0 };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count: today } = await this.supabase!
      .from('attendance_log')
      .select('*', { count: 'exact', head: true })
      .gte('checked_in_at', todayStart.toISOString());
    const { count: total } = await this.supabase!
      .from('attendance_log')
      .select('*', { count: 'exact', head: true });
    return { today: today ?? 0, total: total ?? 0 };
  }

  // Profile update
  async updateProfile(userId: string, updates: Partial<Profile>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('profiles').update(updates).eq('id', userId);
  }

  // Belt exams
  async getBeltExams(userId: string): Promise<BeltExam[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('belt_exams')
      .select('*')
      .eq('user_id', userId)
      .order('exam_date', { ascending: false });
    return data ?? [];
  }

  async addBeltExam(userId: string, examDate: string, beltRank: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('belt_exams').insert({ user_id: userId, exam_date: examDate, belt_rank: beltRank });
  }

  async deleteBeltExam(id: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('belt_exams').delete().eq('id', id);
  }

  // Training camps
  async getTrainingCamps(userId: string): Promise<TrainingCamp[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('training_camps')
      .select('*')
      .eq('user_id', userId)
      .order('camp_date', { ascending: false });
    return data ?? [];
  }

  async addTrainingCamp(userId: string, campDate: string, description: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('training_camps').insert({ user_id: userId, camp_date: campDate, description });
  }

  async deleteTrainingCamp(id: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('training_camps').delete().eq('id', id);
  }
}

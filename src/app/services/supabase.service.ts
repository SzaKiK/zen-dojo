import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

export type BeltLevel = 'white' | 'yellow' | 'orange' | 'green' | 'blue' | 'brown' | 'black' | 'purple';

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  belt_level: BeltLevel;
  qr_code_id: string;
  is_admin: boolean;
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

  signUp(email: string, password: string, fullName: string) {
    if (this.isMockMode) return Promise.resolve({ data: {}, error: null } as any);
    return this.supabase!.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
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

  async bookSession(sessionId: string) {
    if (this.isMockMode) return null;
    const { data: session } = await this.supabase!
      .from('training_sessions')
      .select('current_bookings')
      .eq('id', sessionId)
      .maybeSingle();

    if (session) {
      return this.supabase!
        .from('training_sessions')
        .update({ current_bookings: session.current_bookings + 1 })
        .eq('id', sessionId);
    }
    return null;
  }

  // Bérletek (Memberships/Passes)
  async getAllMemberships(): Promise<(Membership & { profile?: Profile })[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('memberships')
      .select('*, profiles(full_name, belt_level)')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async createMembership(membership: Omit<Membership, 'id'>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('memberships').insert(membership);
  }

  async decrementSession(membershipId: string, currentRemaining: number) {
    if (this.isMockMode) return { error: null };
    return this.supabase!
      .from('memberships')
      .update({ remaining_sessions: currentRemaining - 1 })
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
      .select('*, profiles(full_name, belt_level, avatar_url)')
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
}

import { Injectable, NgZone } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { BehaviorSubject } from 'rxjs';
import { environment } from '../../environments/environment';

// Kyu: 9.kyu (beginner) → 1.kyu; Dan: 1.dan → 10.dan
export const BELT_RANKS = [
  '9.kyu','8.kyu','7.kyu','6.kyu','5.kyu','4.kyu','3.kyu','2.kyu','1.kyu',
  '1.dan','2.dan','3.dan','4.dan','5.dan','6.dan','7.dan','8.dan','9.dan','10.dan',
];

export type AdminRole = 'full_admin' | 'membership_admin' | 'tag_admin' | null;

export interface Profile {
  id: string;
  full_name: string;
  avatar_url: string;
  belt_rank: string | null;
  qr_code_id: string;
  is_admin: boolean;
  admin_role: AdminRole;
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
  valid_until: string | null;
  status: 'active' | 'expired' | 'pending';
}

export interface TrainingSession {
  id: string;
  title: string;
  instructor_name: string;
  location?: string | null;
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

  // Reactive auth state
  private _currentUser$ = new BehaviorSubject<any>(null);
  private _currentProfile$ = new BehaviorSubject<Profile | null>(null);
  readonly currentUser$ = this._currentUser$.asObservable();
  readonly currentProfile$ = this._currentProfile$.asObservable();

  private getAuthRedirectUrl(path = '/'): string {
    const fallbackBase = environment.appUrl || 'https://dhkse.netlify.app';
    if (typeof window === 'undefined') {
      return `${fallbackBase}${path}`;
    }

    const origin = window.location.origin;
    const isLocalhost = origin.includes('localhost') || origin.includes('127.0.0.1');
    const base = isLocalhost ? fallbackBase : origin;
    return `${base}${path}`;
  }

  get isMockMode(): boolean {
    return !environment.supabaseUrl || environment.supabaseUrl === 'YOUR_SUPABASE_URL';
  }

  constructor(private zone: NgZone) {
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

      // Restore session and listen for auth changes
      this.supabase.auth.onAuthStateChange(async (_event, session) => {
        this.zone.run(async () => {
          this._currentUser$.next(session?.user ?? null);
          if (session?.user) {
            const profile = await this.getProfile(session.user.id);
            this._currentProfile$.next(profile);
          } else {
            this._currentProfile$.next(null);
          }
        });
      });
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
      options: {
        emailRedirectTo: this.getAuthRedirectUrl('/login'),
        data: { full_name: fullName, birth_date: birthDate ?? null }
      }
    });
  }

  requestPasswordReset(email: string) {
    if (this.isMockMode) return Promise.resolve({ data: null, error: null } as any);
    return this.supabase!.auth.resetPasswordForEmail(email, {
      redirectTo: this.getAuthRedirectUrl('/login'),
    });
  }

  async signOut() {
    if (this.isMockMode) return { error: null };
    this._currentUser$.next(null);
    this._currentProfile$.next(null);
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

  isFullAdmin(profile: Profile | null | undefined): boolean {
    if (!profile) return false;
    return profile.admin_role === 'full_admin' || (profile.admin_role == null && profile.is_admin);
  }

  isMembershipAdmin(profile: Profile | null | undefined): boolean {
    if (!profile) return false;
    return profile.admin_role === 'full_admin'
      || profile.admin_role === 'membership_admin'
      || (profile.admin_role == null && profile.is_admin);
  }

  isTagAdmin(profile: Profile | null | undefined): boolean {
    if (!profile) return false;
    return profile.admin_role === 'full_admin'
      || profile.admin_role === 'tag_admin'
      || (profile.admin_role == null && profile.is_admin);
  }

  isAnyAdmin(profile: Profile | null | undefined): boolean {
    if (!profile) return false;
    return profile.admin_role === 'full_admin'
      || profile.admin_role === 'membership_admin'
      || profile.admin_role === 'tag_admin'
      || (profile.admin_role == null && profile.is_admin);
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
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async getMembershipHistory(userId: string): Promise<Membership[]> {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('memberships')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return data ?? [];
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

  async createTrainingSession(session: Omit<TrainingSession, 'id' | 'created_at' | 'current_bookings'>) {
    if (this.isMockMode) return { data: null, error: null };
    return this.supabase!.from('training_sessions').insert(session).select().single();
  }

  async updateTrainingSession(id: string, updates: Partial<Omit<TrainingSession, 'id' | 'created_at' | 'current_bookings'>>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('training_sessions').update(updates).eq('id', id);
  }

  async deleteTrainingSession(id: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('training_sessions').delete().eq('id', id);
  }

  async logEventAttendance(adminId: string, userId: string, sessionId: string, force = false) {
    if (this.isMockMode) return { error: null };
    const params: Record<string, unknown> = {
      p_admin_id: adminId,
      p_user_id: userId,
      p_session_id: sessionId,
    };
    if (force) params['p_force'] = true;
    const { data, error } = await this.supabase!.rpc('log_event_attendance', params);
    if (error) return { error: { message: error.message } };
    if (data?.error) return { error: { message: data.error } };
    return {
      error: null,
      data: {
        membership_id: data?.membership_id as string | undefined,
        remaining_sessions: data?.remaining_sessions as number | undefined,
      },
    };
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

    const activeMembership = await this.getMembership(membership.user_id);
    if (activeMembership) {
      return { error: { message: 'Egy tagnak egyszerre csak egy aktív bérlete lehet. Előbb a jelenlegi bérletet kell lezárni vagy lejártnak kell lennie.' } };
    }

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

  async getAdminActionMonthlySummary() {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('admin_action_monthly_summary')
      .select('*')
      .order('month_start', { ascending: false });
    return data ?? [];
  }

  async getAdminActionLogs(limit?: number) {
    if (this.isMockMode) return [];
    let query = this.supabase!
      .from('admin_action_logs')
      .select('*, profiles!admin_action_logs_admin_id_fkey(full_name), target_profile:profiles!admin_action_logs_target_user_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    const { data } = await query;
    return data ?? [];
  }

  async getAllMembersForExport() {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('profiles')
      .select('id, full_name, belt_rank, belt_level, phone, birth_date, medical_validity, membership_fee_paid, admin_role, created_at')
      .order('full_name');
    return data ?? [];
  }

  async getAllMembershipsForExport() {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('memberships')
      .select('id, type, status, total_sessions, remaining_sessions, valid_until, created_at, updated_at, profiles!memberships_user_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async getAllAuditLogsForExport() {
    if (this.isMockMode) return [];
    const { data } = await this.supabase!
      .from('admin_action_logs')
      .select('id, action_type, membership_type, details, created_at, profiles!admin_action_logs_admin_id_fkey(full_name), target_profile:profiles!admin_action_logs_target_user_id_fkey(full_name)')
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  // Profile update
  async updateProfile(userId: string, updates: Partial<Profile>) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('profiles').update(updates).eq('id', userId);
  }

  async setProfileAdminRole(userId: string, role: AdminRole) {
    if (this.isMockMode) return { error: null };
    const { data, error } = await this.supabase!.rpc('set_profile_admin_role', {
      p_target_user_id: userId,
      p_admin_role: role,
    });
    if (error) return { error: { message: error.message } };
    if (data?.error) return { error: { message: data.error } };
    return { error: null };
  }

  async deleteProfile(userId: string) {
    if (this.isMockMode) return { error: null };
    return this.supabase!.from('profiles').delete().eq('id', userId);
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

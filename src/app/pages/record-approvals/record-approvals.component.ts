import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MemberRecordRequest, SupabaseService } from '../../services/supabase.service';

@Component({
  selector: 'app-record-approvals',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './record-approvals.component.html',
  styleUrl: './record-approvals.component.scss',
})
export class RecordApprovalsComponent implements OnInit {
  requests: MemberRecordRequest[] = [];
  loading = true;
  reviewingId = '';
  statusMessage = '';
  statusError = false;
  reviewNotes: Record<string, string> = {};

  constructor(private supabase: SupabaseService) {}

  async ngOnInit() {
    await this.loadRequests();
    this.loading = false;
  }

  async loadRequests() {
    this.requests = await this.supabase.getPendingMemberRecordRequests();
  }

  async reviewRequest(request: MemberRecordRequest, approve: boolean) {
    if (this.reviewingId) return;
    this.reviewingId = request.id;
    this.statusMessage = '';
    const { error } = await this.supabase.reviewMemberRecordRequest(
      request.id,
      approve,
      this.reviewNotes[request.id] ?? '',
    );
    this.reviewingId = '';
    this.statusError = !!error;
    this.statusMessage = error
      ? error.message || 'A kérelem feldolgozása nem sikerült.'
      : approve ? 'Kérelem jóváhagyva.' : 'Kérelem elutasítva.';
    if (!error) await this.loadRequests();
  }

  requestTypeLabel(type: MemberRecordRequest['request_type']): string {
    return type === 'belt_exam' ? 'Övvizsga' : 'Edzőtábor';
  }
}
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './admin-dashboard.component.html',
  styleUrl: './admin-dashboard.component.scss',
})
export class AdminDashboardComponent {
  attendancePercent = 60;
  totalExpected = 40;
  totalArrived = 24;

  recentCheckins = [
    { initials: 'MA', name: 'Metzger Antal', belt: 'Fekete Öv 6. dan', dojo: 'Dojo Metzger', time: '18:42', ago: 'Éppen most' },
    { initials: 'FZ', name: 'Farkas Zoltán', belt: 'Fekete Öv 2. dan', dojo: 'Dojo Metzger', time: '18:15', ago: '30 perce' },
    { initials: 'RR', name: 'Rácz Richárd', belt: 'Fekete Öv 1. dan', dojo: 'Senshi Usagi', time: '17:50', ago: '55 perce' },
  ];
}

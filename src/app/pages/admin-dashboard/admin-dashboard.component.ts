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
    { initials: 'NK', name: 'Nagy Krisztián', belt: 'Fekete Öv', dojo: 'Dojo 1', time: '18:42', ago: 'Éppen most' },
    { initials: 'SB', name: 'Szabó Balázs', belt: 'Kék Öv', dojo: 'Dojo 2', time: '18:15', ago: '30 perce' },
    { initials: 'TL', name: 'Tóth Luca', belt: 'Fehér Öv', dojo: 'Gyerek Csoport', time: '17:50', ago: '55 perce' },
  ];
}

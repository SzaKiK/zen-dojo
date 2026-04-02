import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './training.component.html',
  styleUrl: './training.component.scss',
})
export class TrainingComponent {
  selectedDay = 'Hétfő';
  days = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek', 'Szombat'];

  sessions = [
    { time: '06:00 - 07:30', title: 'Reggeli Küzdősport', instructor: 'Tanaka Sensei', level: 'Haladó', spots: 8, total: 20, levelClass: 'advanced' },
    { time: '09:00 - 10:30', title: 'Cselgáncs Alapok', instructor: 'Horváth Mester', level: 'Kezdő', spots: 15, total: 25, levelClass: 'beginner' },
    { time: '16:00 - 17:00', title: 'Gyerek Karate', instructor: 'Kiss Edző', level: 'Gyerekeknek', spots: 5, total: 15, levelClass: 'kids' },
    { time: '18:00 - 19:30', title: 'Küzdősport Technika', instructor: 'Tanaka Sensei', level: 'Összes szint', spots: 12, total: 30, levelClass: 'all' },
    { time: '20:00 - 21:30', title: 'Speciális Edzés', instructor: 'Meghívott Mester', level: 'Fekete öv', spots: 3, total: 10, levelClass: 'master' },
  ];

  selectDay(day: string) {
    this.selectedDay = day;
  }
}

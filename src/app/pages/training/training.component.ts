import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Session {
  time: string;
  title: string;
  instructor: string;
  level: string;
  spots: number;
  total: number;
  levelClass: string;
  dojo: string;
}

@Component({
  selector: 'app-training',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './training.component.html',
  styleUrl: './training.component.scss',
})
export class TrainingComponent {
  selectedDay = 'Hétfő';
  days = ['Hétfő', 'Kedd', 'Csütörtök', 'Péntek'];

  allSessions: Record<string, Session[]> = {
    'Hétfő': [
      { time: '18:00 - 19:30', title: 'Kempo', instructor: 'Shihan Metzger Antal', level: 'Gyerek és felnőtt', spots: 12, total: 25, levelClass: 'all', dojo: 'Dojo Metzger, Bicske' },
    ],
    'Kedd': [
      { time: '18:00 - 19:00', title: 'Cross Fitness', instructor: 'Shihan Metzger Antal', level: 'Összes szint', spots: 10, total: 20, levelClass: 'all', dojo: 'Dojo Metzger, Bicske' },
      { time: '19:00 - 20:00', title: 'Kempo Versenyző', instructor: 'Sensei Farkas Zoltán', level: 'Versenyző', spots: 8, total: 15, levelClass: 'advanced', dojo: 'Dojo Metzger, Bicske' },
      { time: '18:15 - 19:30', title: 'Kempo', instructor: 'Sensei Rácz Richárd', level: 'Gyerek és felnőtt', spots: 10, total: 20, levelClass: 'all', dojo: 'Senshi Usagi, Tabajd' },
    ],
    'Csütörtök': [
      { time: '18:00 - 19:30', title: 'Kempo Kezdő', instructor: 'Shihan Metzger Antal', level: 'Gyerek és kezdő felnőtt', spots: 15, total: 25, levelClass: 'beginner', dojo: 'Dojo Metzger, Bicske' },
    ],
    'Péntek': [
      { time: '17:30 - 19:00', title: 'Kempo', instructor: 'Sensei Rácz Richárd', level: 'Gyerek és felnőtt', spots: 10, total: 20, levelClass: 'all', dojo: 'Senshi Usagi, Tabajd' },
    ],
  };

  get sessions() {
    return this.allSessions[this.selectedDay] ?? [];
  }

  selectDay(day: string) {
    this.selectedDay = day;
  }
}

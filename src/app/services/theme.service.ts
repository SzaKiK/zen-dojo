import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly KEY = 'dhkse-theme';
  theme: 'dark' | 'light' = 'dark';

  constructor() {
    const saved = localStorage.getItem(this.KEY) as 'dark' | 'light' | null;
    this.theme = saved ?? 'dark';
    this.apply();
  }

  toggle() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(this.KEY, this.theme);
    this.apply();
  }

  get isDark(): boolean {
    return this.theme === 'dark';
  }

  private apply() {
    document.documentElement.setAttribute('data-theme', this.theme);
  }
}

import { Component, forwardRef } from '@angular/core';
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-date-selector',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './date-selector.component.html',
  styleUrl: './date-selector.component.scss',
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => DateSelectorComponent),
    multi: true,
  }],
})
export class DateSelectorComponent implements ControlValueAccessor {
  readonly months = [
    'január', 'február', 'március', 'április', 'május', 'június',
    'július', 'augusztus', 'szeptember', 'október', 'november', 'december',
  ];
  readonly years = Array.from({ length: new Date().getFullYear() - 1899 }, (_, index) => new Date().getFullYear() - index);

  day: number | null = null;
  month: number | null = null;
  year: number | null = null;
  disabled = false;

  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  get days(): number[] {
    const count = this.month && this.year
      ? new Date(this.year, this.month, 0).getDate()
      : 31;
    return Array.from({ length: count }, (_, index) => index + 1);
  }

  get hasValue(): boolean {
    return this.day !== null || this.month !== null || this.year !== null;
  }

  writeValue(value: string | null): void {
    if (!value) {
      this.day = this.month = this.year = null;
      return;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return;
    this.year = Number(match[1]);
    this.month = Number(match[2]);
    this.day = Number(match[3]);
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  updatePart(part: 'day' | 'month' | 'year', value: number | null): void {
    this[part] = value;
    if ((part === 'month' || part === 'year') && this.day && this.day > this.days.length) {
      this.day = this.days.length;
    }

    this.onTouched();
    if (this.day && this.month && this.year) {
      this.onChange(`${this.year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`);
    } else if (!this.hasValue) {
      this.onChange(null);
    }
  }

  clear(): void {
    this.day = this.month = this.year = null;
    this.onChange(null);
    this.onTouched();
  }
}
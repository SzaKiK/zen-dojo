import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/welcome/welcome.component').then(m => m.WelcomeComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent) },
  { path: 'membership-card', loadComponent: () => import('./pages/membership-card/membership-card.component').then(m => m.MembershipCardComponent) },
  { path: 'admin', loadComponent: () => import('./pages/admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent) },
  { path: 'members', loadComponent: () => import('./pages/member-list/member-list.component').then(m => m.MemberListComponent) },
  { path: 'training', loadComponent: () => import('./pages/training/training.component').then(m => m.TrainingComponent) },
  { path: '**', redirectTo: '' }
];

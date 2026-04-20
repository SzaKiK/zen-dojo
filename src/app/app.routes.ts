import { Routes } from '@angular/router';
import { authGuard, adminGuard, fullAdminGuard, anyAdminGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/welcome/welcome.component').then(m => m.WelcomeComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent) },
  { path: 'membership-card', canActivate: [authGuard], loadComponent: () => import('./pages/membership-card/membership-card.component').then(m => m.MembershipCardComponent) },
  { path: 'training', canActivate: [authGuard], loadComponent: () => import('./pages/training/training.component').then(m => m.TrainingComponent) },
  { path: 'berletek', canActivate: [authGuard], loadComponent: () => import('./pages/berletek/berletek.component').then(m => m.BerletetComponent) },
  { path: 'admin', canActivate: [fullAdminGuard], loadComponent: () => import('./pages/admin-dashboard/admin-dashboard.component').then(m => m.AdminDashboardComponent) },
  { path: 'audit', canActivate: [fullAdminGuard], loadComponent: () => import('./pages/audit-log/audit-log.component').then(m => m.AuditLogComponent) },
  { path: 'sessions-admin', canActivate: [fullAdminGuard], loadComponent: () => import('./pages/session-manager/session-manager.component').then(m => m.SessionManagerComponent) },
  { path: 'members', canActivate: [anyAdminGuard], loadComponent: () => import('./pages/member-list/member-list.component').then(m => m.MemberListComponent) },
  { path: 'members/:userId', canActivate: [anyAdminGuard], loadComponent: () => import('./pages/membership-card/membership-card.component').then(m => m.MembershipCardComponent) },
  { path: 'qr-scanner', canActivate: [adminGuard], loadComponent: () => import('./pages/qr-scanner/qr-scanner.component').then(m => m.QrScannerComponent) },
  { path: '**', redirectTo: '' }
];

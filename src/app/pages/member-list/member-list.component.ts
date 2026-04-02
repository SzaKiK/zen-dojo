import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService, Profile, Membership } from '../../services/supabase.service';

@Component({
  selector: 'app-member-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './member-list.component.html',
  styleUrl: './member-list.component.scss',
})
export class MemberListComponent implements OnInit {
  searchQuery = '';
  activeFilter = 'all';
  members: (Profile & { status: string })[] = [];

  // Demo members matching the Stitch design
  demoMembers: (Profile & { status: string })[] = [
    {
      id: '1', full_name: 'Kovács István', belt_level: 'brown', status: 'active',
      avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBxLx9p_03JkIUtdvoKLATjXqFhQ6HUkBnuyaFCyDLmmXInilokeJ5LTk9L0wkQW5hJc723bfyEp26wF0XUOK38hbE3K5bsz0mwspuekk4_T7PWtoIjqX7StbQWKvQmcWMFvQl8LEUfdDitwNKP0PnAiUxny-tGZF98vA-h7De2Xvj3L2DZX9jb31j5myvRiAxiV99t00GdVLr9uUnq5v8Yjs_s-AaKaOdXCnIaFeCtptEUQW9TP-62FHhFActqj07C6D8oGx0W82',
      qr_code_id: '001', is_admin: false,
    },
    {
      id: '2', full_name: 'Nagy Júlia', belt_level: 'blue', status: 'active',
      avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA2rgkIpOqymcnuwTVLWb18RLSGN42xo8ELyY60aews3zy-l87P-AF3PPXjyAudyTQlrtlVaw79oMXVbGAnTxxpdsB_IRWpihdvmgtmRRS1-0WM5mxGf6QBXv3vwbNbsfw8s8D5B-4bHlqEELIQjRmeTSmUhbpGz7FyO-7v__AkmG1CN2DNG6cHH-HVQ_rKcigg6t7loGN6Y2BLmsGU5rEYL_5a0mApF15uKai8jo5EMKXfkuY6t7jO8st-80FLRzd54u8AzCowHkA',
      qr_code_id: '002', is_admin: false,
    },
    {
      id: '3', full_name: 'Szabó Péter', belt_level: 'yellow', status: 'expired',
      avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCb3pVwB6glYRAAej6goprwiO_-34IFnYkSyuM0_dMGOdLoWB-lBGyyzIVp2gneO_DnLaY5dnLlQbJny5jOnI3iVtyOaF00f4qF2nBqUXjH5A2CbL7QVNbQOZThwOP5ygzcYaPLk9njf2lZoTdUP43iEXG1ag9rURagmz_gugOQ7sHWqzzFRe-RS4bdisNqwQyxPrbV67S9OMzmFBXfQ85TjsBRjT8oWr2-iC7qTvF5zHoplgKSb2L-7RAVb3hW8IIQBeJDttqcCkQ',
      qr_code_id: '003', is_admin: false,
    },
    {
      id: '4', full_name: 'Horváth Áron', belt_level: 'white', status: 'active',
      avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBxHBvk5ed5gBcIkuQEa85lMFt3MqtJdu1Tp3pJJz1mAEIRXKcGCzk95rYI-yM7GTmVtXoCtIJL4j8EjEu1Mru4fLNZB6Gce0gk66IUuZ0WmSmgc7gRzYAwY6HyLAWjc9SffaJcn6gHiPpbJgAR9RzTZl4h4_q44nDZdGXN2h5wGbWLv4rRtF1nrpocinZwfNnAV2tywsAQ9ctMNw58lYQAdJZY6UJDLbwHKWTTnqbKjpIwuhBNnX2AMPseRGHTuffLTtOUUD032TQ',
      qr_code_id: '004', is_admin: false,
    },
    {
      id: '5', full_name: 'Kiss Edit', belt_level: 'purple', status: 'active',
      avatar_url: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBlOYzc76WXk1zpiMSLqzg-vf0VaHezLJZv1a6jzFPKwcS2MWr1eDJST6GhOXKcXK0-8fgf8JA-LTcg3oaap-ErCfjrRI-Qmy3zYbQvVDBJyDj7hwB-XfKNKzlDyhMGL9kfjMSVNH34X81WsJe6DHU4Zx7HFuEtw-vWshbpNlmunfhwnk3o6dOMgwVFBZE0OZHHmybGLJWk4nAAOFxK-9plQZu3z9GNZ728SWVJ62sq2Q0-QPIRucNxlcQ9f50VrOP8xON8tnMtYQo',
      qr_code_id: '005', is_admin: false,
    },
  ];

  constructor(private supabase: SupabaseService, private router: Router) {}

  async logout() {
    await this.supabase.signOut();
    this.router.navigate(['/']);
  }

  async ngOnInit() {
    const profiles = await this.supabase.getAllProfiles();
    if (profiles.length > 0) {
      const memberships = await this.supabase.getAllMemberships();
      this.members = profiles.map((p) => {
        const m = memberships.find(mb => mb.user_id === p.id);
        return { ...p, status: m?.status === 'active' ? 'active' : (m ? 'expired' : 'active') };
      });
    } else {
      this.members = this.demoMembers;
    }
  }

  viewMember(member: Profile & { status: string }) {
    this.router.navigate(['/members', member.id]);
  }

  get filteredMembers() {
    let result = this.members;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      result = result.filter((m) => m.full_name.toLowerCase().includes(q));
    }
    if (this.activeFilter !== 'all') {
      result = result.filter((m) => m.status === this.activeFilter);
    }
    return result;
  }

  beltName(level: string): string {
    const map: Record<string, string> = {
      white: 'Fehér öv - White Belt', yellow: 'Sárga öv - Yellow Belt',
      orange: 'Narancs öv - Orange Belt', green: 'Zöld öv - Green Belt',
      blue: 'Kék öv - Blue Belt', purple: 'Lila öv - Purple Belt',
      brown: 'Barna öv - Brown Belt', black: 'Fekete öv - Black Belt',
    };
    return map[level] ?? level;
  }

  setFilter(filter: string) {
    this.activeFilter = filter;
  }
}

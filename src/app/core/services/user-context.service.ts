import { Injectable, signal } from '@angular/core';
import { UserProfile } from '../models';

export const DEFAULT_CURRENT_USER: UserProfile = {
  id: 'user-nadia',
  name: 'Nadia Hassan',
  department: 'Platform Engineering',
  email: 'nadia.hassan@cairohub.example'
};

export const AVAILABLE_DEMO_USERS: readonly UserProfile[] = [
  DEFAULT_CURRENT_USER,
  {
    id: 'user-omar',
    name: 'Omar Tarek',
    department: 'Product Architecture',
    email: 'omar.tarek@cairohub.example'
  }
];

@Injectable({ providedIn: 'root' })
export class UserContextService {
  private readonly userSignal = signal<UserProfile>(DEFAULT_CURRENT_USER);

  readonly currentUser = this.userSignal.asReadonly();
  readonly availableUsers = AVAILABLE_DEMO_USERS;

  setCurrentUser(user: UserProfile): void {
    this.userSignal.set(user);
  }
}

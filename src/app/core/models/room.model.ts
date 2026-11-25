export type EquipmentType =
  | 'projector'
  | 'whiteboard'
  | 'video-conferencing'
  | 'tv-screen'
  | 'conference-phone'
  | 'accessibility';

export interface Room {
  readonly id: string;
  readonly name: string;
  readonly floor: number;
  readonly capacity: number;
  readonly equipment: readonly EquipmentType[];
}

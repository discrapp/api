import { describe, it, expect } from 'vitest';
import type { Profile, NewProfile } from './profiles';
import type { QrCode, NewQrCode } from './qr-codes';
import type { Disc, NewDisc } from './discs';
import type { DiscPhoto, NewDiscPhoto } from './disc-photos';
import type { RecoveryEvent, NewRecoveryEvent } from './recovery-events';
import type { MeetupProposal, NewMeetupProposal } from './meetup-proposals';

describe('schema type inference', () => {
  it('should infer Profile types correctly', () => {
    const newProfile: NewProfile = {
      username: 'testuser',
      email: 'test@example.com',
    };

    const profile: Profile = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      username: 'testuser',
      email: 'test@example.com',
      full_name: null,
      avatar_url: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newProfile.username).toBe('testuser');
    expect(profile.id).toBeDefined();
  });

  it('should infer QrCode types correctly', () => {
    const newQrCode: NewQrCode = {
      short_code: 'ABC123',
    };

    const qrCode: QrCode = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      short_code: 'ABC123',
      status: 'generated',
      assigned_to: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newQrCode.short_code).toBe('ABC123');
    expect(qrCode.status).toBe('generated');
  });

  it('should infer Disc types correctly', () => {
    const newDisc: NewDisc = {
      owner_id: '123e4567-e89b-12d3-a456-426614174000',
      name: 'Destroyer',
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    };

    const disc: Disc = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      owner_id: '123e4567-e89b-12d3-a456-426614174000',
      qr_code_id: null,
      name: 'Destroyer',
      manufacturer: null,
      plastic: null,
      weight: null,
      flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
      reward_amount: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newDisc.name).toBe('Destroyer');
    expect(disc.flight_numbers.speed).toBe(12);
  });

  it('should infer DiscPhoto types correctly', () => {
    const newDiscPhoto: NewDiscPhoto = {
      disc_id: '123e4567-e89b-12d3-a456-426614174000',
      storage_path: '/photos/disc123.jpg',
    };

    const discPhoto: DiscPhoto = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      disc_id: '123e4567-e89b-12d3-a456-426614174000',
      storage_path: '/photos/disc123.jpg',
      photo_uuid: '550e8400-e29b-41d4-a716-446655440000',
      created_at: new Date(),
    };

    expect(newDiscPhoto.storage_path).toBe('/photos/disc123.jpg');
    expect(discPhoto.photo_uuid).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should infer RecoveryEvent types correctly', () => {
    const newRecoveryEvent: NewRecoveryEvent = {
      disc_id: '123e4567-e89b-12d3-a456-426614174000',
      finder_id: '123e4567-e89b-12d3-a456-426614174001',
    };

    const recoveryEvent: RecoveryEvent = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      disc_id: '123e4567-e89b-12d3-a456-426614174000',
      finder_id: '123e4567-e89b-12d3-a456-426614174001',
      status: 'found',
      found_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newRecoveryEvent.disc_id).toBeDefined();
    expect(recoveryEvent.status).toBe('found');
  });

  it('should infer MeetupProposal types correctly', () => {
    const newMeetupProposal: NewMeetupProposal = {
      recovery_event_id: '123e4567-e89b-12d3-a456-426614174000',
      proposed_by: '123e4567-e89b-12d3-a456-426614174001',
    };

    const meetupProposal: MeetupProposal = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      recovery_event_id: '123e4567-e89b-12d3-a456-426614174000',
      proposed_by: '123e4567-e89b-12d3-a456-426614174001',
      location: null,
      coordinates: null,
      datetime: null,
      status: 'proposed',
      created_at: new Date(),
      updated_at: new Date(),
    };

    expect(newMeetupProposal.proposed_by).toBeDefined();
    expect(meetupProposal.status).toBe('proposed');
  });
});

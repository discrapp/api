/**
 * Tests for the shared Zod validation module
 */

import { assertEquals, assertExists } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import {
  // Schemas
  UuidSchema,
  ShippingAddressSchema,
  FlightNumbersSchema,
  NotificationTypeSchema,
  OrderStatusSchema,
  DiscCategorySchema,
  DiscStabilitySchema,
  CreateStickerOrderSchema,
  ProposeMeetupSchema,
  ReportFoundDiscSchema,
  CreateDiscSchema,
  UpdateDiscSchema,
  RegisterPushTokenSchema,
  SaveDefaultAddressSchema,
  MarkDiscRetrievedSchema,
  AcceptMeetupSchema,
  DeclineMeetupSchema,
  CreateDropOffSchema,
  AbandonDiscSchema,
  SurrenderDiscSchema,
  ClaimDiscSchema,
  CompleteRecoverySchema,
  RelinquishDiscSchema,
  MarkRewardPaidSchema,
  ValidateAddressSchema,
  CreateNotificationSchema,
  LinkQrToDiscSchema,
  UnlinkQrCodeSchema,
  AssignQrCodeSchema,
  UpdateOrderStatusSchema,
  SubmitDiscToCatalogSchema,
  DeleteDiscSchema,
  DismissNotificationSchema,
  MarkNotificationReadSchema,
  // Helper functions
  validateRequest,
  formatZodError,
  validationErrorResponse,
} from './validation.ts';

// =============================================================================
// Test Constants
// =============================================================================

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const INVALID_UUID = 'not-a-uuid';

// =============================================================================
// UuidSchema Tests
// =============================================================================

Deno.test('UuidSchema - accepts valid UUID', () => {
  const result = UuidSchema.safeParse(VALID_UUID);
  assertEquals(result.success, true);
});

Deno.test('UuidSchema - rejects invalid UUID', () => {
  const result = UuidSchema.safeParse(INVALID_UUID);
  assertEquals(result.success, false);
});

Deno.test('UuidSchema - rejects empty string', () => {
  const result = UuidSchema.safeParse('');
  assertEquals(result.success, false);
});

// =============================================================================
// ShippingAddressSchema Tests
// =============================================================================

Deno.test('ShippingAddressSchema - accepts valid address', () => {
  const validAddress = {
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = ShippingAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.country, 'US'); // Default value
  }
});

Deno.test('ShippingAddressSchema - accepts address with optional fields', () => {
  const validAddress = {
    name: 'John Doe',
    street_address: '123 Main St',
    street_address_2: 'Apt 4B',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
    country: 'CA',
  };
  const result = ShippingAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.country, 'CA');
    assertEquals(result.data.street_address_2, 'Apt 4B');
  }
});

Deno.test('ShippingAddressSchema - rejects missing required fields', () => {
  const invalidAddress = {
    name: 'John Doe',
    // Missing street_address
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = ShippingAddressSchema.safeParse(invalidAddress);
  assertEquals(result.success, false);
});

Deno.test('ShippingAddressSchema - rejects empty name', () => {
  const invalidAddress = {
    name: '',
    street_address: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = ShippingAddressSchema.safeParse(invalidAddress);
  assertEquals(result.success, false);
});

// =============================================================================
// FlightNumbersSchema Tests
// =============================================================================

Deno.test('FlightNumbersSchema - accepts valid flight numbers', () => {
  const validFlightNumbers = {
    speed: 9,
    glide: 5,
    turn: -1,
    fade: 2,
  };
  const result = FlightNumbersSchema.safeParse(validFlightNumbers);
  assertEquals(result.success, true);
});

Deno.test('FlightNumbersSchema - accepts flight numbers with optional stability', () => {
  const validFlightNumbers = {
    speed: 9,
    glide: 5,
    turn: -1,
    fade: 2,
    stability: 1.5,
  };
  const result = FlightNumbersSchema.safeParse(validFlightNumbers);
  assertEquals(result.success, true);
});

Deno.test('FlightNumbersSchema - rejects speed out of range', () => {
  const invalid = { speed: 15, glide: 5, turn: -1, fade: 2 }; // Speed > 14
  const result = FlightNumbersSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test('FlightNumbersSchema - rejects glide out of range', () => {
  const invalid = { speed: 9, glide: 8, turn: -1, fade: 2 }; // Glide > 7
  const result = FlightNumbersSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test('FlightNumbersSchema - rejects turn out of range', () => {
  const invalid = { speed: 9, glide: 5, turn: 6, fade: 2 }; // Turn > 5
  const result = FlightNumbersSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test('FlightNumbersSchema - rejects fade out of range', () => {
  const invalid = { speed: 9, glide: 5, turn: -1, fade: 6 }; // Fade > 5
  const result = FlightNumbersSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

// =============================================================================
// NotificationTypeSchema Tests
// =============================================================================

Deno.test('NotificationTypeSchema - accepts valid types', () => {
  const validTypes = ['disc_found', 'meetup_proposed', 'meetup_accepted', 'meetup_declined', 'disc_recovered'];
  for (const type of validTypes) {
    const result = NotificationTypeSchema.safeParse(type);
    assertEquals(result.success, true, `Should accept '${type}'`);
  }
});

Deno.test('NotificationTypeSchema - rejects invalid type', () => {
  const result = NotificationTypeSchema.safeParse('invalid_type');
  assertEquals(result.success, false);
});

// =============================================================================
// OrderStatusSchema Tests
// =============================================================================

Deno.test('OrderStatusSchema - accepts valid statuses', () => {
  const validStatuses = ['processing', 'printed', 'shipped', 'delivered'];
  for (const status of validStatuses) {
    const result = OrderStatusSchema.safeParse(status);
    assertEquals(result.success, true, `Should accept '${status}'`);
  }
});

Deno.test('OrderStatusSchema - rejects invalid status', () => {
  const result = OrderStatusSchema.safeParse('pending');
  assertEquals(result.success, false);
});

// =============================================================================
// DiscCategorySchema Tests
// =============================================================================

Deno.test('DiscCategorySchema - accepts valid categories', () => {
  const validCategories = [
    'Distance Driver',
    'Control Driver',
    'Hybrid Driver',
    'Midrange',
    'Putter',
    'Approach Discs',
  ];
  for (const category of validCategories) {
    const result = DiscCategorySchema.safeParse(category);
    assertEquals(result.success, true, `Should accept '${category}'`);
  }
});

// =============================================================================
// DiscStabilitySchema Tests
// =============================================================================

Deno.test('DiscStabilitySchema - accepts valid stability values', () => {
  const validStabilities = ['Very Overstable', 'Overstable', 'Stable', 'Understable', 'Very Understable'];
  for (const stability of validStabilities) {
    const result = DiscStabilitySchema.safeParse(stability);
    assertEquals(result.success, true, `Should accept '${stability}'`);
  }
});

// =============================================================================
// CreateStickerOrderSchema Tests
// =============================================================================

Deno.test('CreateStickerOrderSchema - accepts order with shipping_address_id', () => {
  const validOrder = {
    quantity: 5,
    shipping_address_id: VALID_UUID,
  };
  const result = CreateStickerOrderSchema.safeParse(validOrder);
  assertEquals(result.success, true);
});

Deno.test('CreateStickerOrderSchema - accepts order with shipping_address', () => {
  const validOrder = {
    quantity: 5,
    shipping_address: {
      name: 'John Doe',
      street_address: '123 Main St',
      city: 'Portland',
      state: 'OR',
      postal_code: '97201',
    },
  };
  const result = CreateStickerOrderSchema.safeParse(validOrder);
  assertEquals(result.success, true);
});

Deno.test('CreateStickerOrderSchema - rejects order without address', () => {
  const invalidOrder = {
    quantity: 5,
  };
  const result = CreateStickerOrderSchema.safeParse(invalidOrder);
  assertEquals(result.success, false);
});

Deno.test('CreateStickerOrderSchema - rejects quantity less than 1', () => {
  const invalidOrder = {
    quantity: 0,
    shipping_address_id: VALID_UUID,
  };
  const result = CreateStickerOrderSchema.safeParse(invalidOrder);
  assertEquals(result.success, false);
});

Deno.test('CreateStickerOrderSchema - rejects non-integer quantity', () => {
  const invalidOrder = {
    quantity: 2.5,
    shipping_address_id: VALID_UUID,
  };
  const result = CreateStickerOrderSchema.safeParse(invalidOrder);
  assertEquals(result.success, false);
});

Deno.test('CreateStickerOrderSchema - accepts order with both address options', () => {
  const validOrder = {
    quantity: 5,
    shipping_address_id: VALID_UUID,
    shipping_address: {
      name: 'John Doe',
      street_address: '123 Main St',
      city: 'Portland',
      state: 'OR',
      postal_code: '97201',
    },
  };
  const result = CreateStickerOrderSchema.safeParse(validOrder);
  assertEquals(result.success, true);
});

// =============================================================================
// ProposeMeetupSchema Tests
// =============================================================================

Deno.test('ProposeMeetupSchema - accepts valid meetup proposal', () => {
  const validProposal = {
    recovery_event_id: VALID_UUID,
    location_name: 'Downtown Park',
    latitude: 45.5231,
    longitude: -122.6765,
    proposed_datetime: '2024-01-15T14:00:00Z',
    message: 'Let me know if this works!',
  };
  const result = ProposeMeetupSchema.safeParse(validProposal);
  assertEquals(result.success, true);
});

Deno.test('ProposeMeetupSchema - accepts proposal without optional fields', () => {
  const validProposal = {
    recovery_event_id: VALID_UUID,
    location_name: 'Downtown Park',
    proposed_datetime: '2024-01-15T14:00:00Z',
  };
  const result = ProposeMeetupSchema.safeParse(validProposal);
  assertEquals(result.success, true);
});

Deno.test('ProposeMeetupSchema - rejects invalid UUID', () => {
  const invalidProposal = {
    recovery_event_id: INVALID_UUID,
    location_name: 'Downtown Park',
    proposed_datetime: '2024-01-15T14:00:00Z',
  };
  const result = ProposeMeetupSchema.safeParse(invalidProposal);
  assertEquals(result.success, false);
});

Deno.test('ProposeMeetupSchema - rejects invalid datetime', () => {
  const invalidProposal = {
    recovery_event_id: VALID_UUID,
    location_name: 'Downtown Park',
    proposed_datetime: 'not-a-date',
  };
  const result = ProposeMeetupSchema.safeParse(invalidProposal);
  assertEquals(result.success, false);
});

// =============================================================================
// ReportFoundDiscSchema Tests
// =============================================================================

Deno.test('ReportFoundDiscSchema - accepts valid report', () => {
  const validReport = {
    qr_code: 'ABC123',
    message: 'Found at the 8th hole',
  };
  const result = ReportFoundDiscSchema.safeParse(validReport);
  assertEquals(result.success, true);
});

Deno.test('ReportFoundDiscSchema - accepts report without message', () => {
  const validReport = {
    qr_code: 'ABC123',
  };
  const result = ReportFoundDiscSchema.safeParse(validReport);
  assertEquals(result.success, true);
});

Deno.test('ReportFoundDiscSchema - rejects empty qr_code', () => {
  const invalidReport = {
    qr_code: '',
  };
  const result = ReportFoundDiscSchema.safeParse(invalidReport);
  assertEquals(result.success, false);
});

// =============================================================================
// CreateDiscSchema Tests
// =============================================================================

Deno.test('CreateDiscSchema - accepts valid disc', () => {
  const validDisc = {
    manufacturer: 'Innova',
    mold: 'Destroyer',
    plastic: 'Star',
    weight: 175,
    color: 'Blue',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
    reward_amount: 10,
    notes: 'My favorite driver',
  };
  const result = CreateDiscSchema.safeParse(validDisc);
  assertEquals(result.success, true);
});

Deno.test('CreateDiscSchema - accepts disc with only required fields', () => {
  const validDisc = {
    mold: 'Destroyer',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
  };
  const result = CreateDiscSchema.safeParse(validDisc);
  assertEquals(result.success, true);
});

Deno.test('CreateDiscSchema - rejects missing mold', () => {
  const invalidDisc = {
    manufacturer: 'Innova',
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
  };
  const result = CreateDiscSchema.safeParse(invalidDisc);
  assertEquals(result.success, false);
});

Deno.test('CreateDiscSchema - rejects missing flight_numbers', () => {
  const invalidDisc = {
    mold: 'Destroyer',
  };
  const result = CreateDiscSchema.safeParse(invalidDisc);
  assertEquals(result.success, false);
});

Deno.test('CreateDiscSchema - rejects negative weight', () => {
  const invalidDisc = {
    mold: 'Destroyer',
    weight: -10,
    flight_numbers: { speed: 12, glide: 5, turn: -1, fade: 3 },
  };
  const result = CreateDiscSchema.safeParse(invalidDisc);
  assertEquals(result.success, false);
});

// =============================================================================
// UpdateDiscSchema Tests
// =============================================================================

Deno.test('UpdateDiscSchema - accepts valid update', () => {
  const validUpdate = {
    disc_id: VALID_UUID,
    mold: 'Wraith',
    color: 'Red',
  };
  const result = UpdateDiscSchema.safeParse(validUpdate);
  assertEquals(result.success, true);
});

Deno.test('UpdateDiscSchema - accepts update with flight_numbers', () => {
  const validUpdate = {
    disc_id: VALID_UUID,
    flight_numbers: { speed: 11, glide: 5, turn: -1, fade: 3 },
  };
  const result = UpdateDiscSchema.safeParse(validUpdate);
  assertEquals(result.success, true);
});

Deno.test('UpdateDiscSchema - rejects invalid disc_id', () => {
  const invalidUpdate = {
    disc_id: INVALID_UUID,
    mold: 'Wraith',
  };
  const result = UpdateDiscSchema.safeParse(invalidUpdate);
  assertEquals(result.success, false);
});

// =============================================================================
// RegisterPushTokenSchema Tests
// =============================================================================

Deno.test('RegisterPushTokenSchema - accepts ExponentPushToken', () => {
  const validToken = {
    push_token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  };
  const result = RegisterPushTokenSchema.safeParse(validToken);
  assertEquals(result.success, true);
});

Deno.test('RegisterPushTokenSchema - accepts ExpoPushToken', () => {
  const validToken = {
    push_token: 'ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  };
  const result = RegisterPushTokenSchema.safeParse(validToken);
  assertEquals(result.success, true);
});

Deno.test('RegisterPushTokenSchema - rejects invalid token format', () => {
  const invalidToken = {
    push_token: 'InvalidToken123',
  };
  const result = RegisterPushTokenSchema.safeParse(invalidToken);
  assertEquals(result.success, false);
});

Deno.test('RegisterPushTokenSchema - rejects empty token', () => {
  const invalidToken = {
    push_token: '',
  };
  const result = RegisterPushTokenSchema.safeParse(invalidToken);
  assertEquals(result.success, false);
});

// =============================================================================
// SaveDefaultAddressSchema Tests
// =============================================================================

Deno.test('SaveDefaultAddressSchema - accepts valid address', () => {
  const validAddress = {
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = SaveDefaultAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
});

Deno.test('SaveDefaultAddressSchema - accepts address with address_id for update', () => {
  const validAddress = {
    address_id: VALID_UUID,
    name: 'John Doe',
    street_address: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = SaveDefaultAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
});

// =============================================================================
// CreateDropOffSchema Tests
// =============================================================================

Deno.test('CreateDropOffSchema - accepts valid drop-off', () => {
  const validDropOff = {
    recovery_event_id: VALID_UUID,
    photo_url: 'https://example.com/photo.jpg',
    latitude: 45.5231,
    longitude: -122.6765,
    location_notes: 'Under the bench',
  };
  const result = CreateDropOffSchema.safeParse(validDropOff);
  assertEquals(result.success, true);
});

Deno.test('CreateDropOffSchema - rejects invalid photo URL', () => {
  const invalidDropOff = {
    recovery_event_id: VALID_UUID,
    photo_url: 'not-a-url',
    latitude: 45.5231,
    longitude: -122.6765,
  };
  const result = CreateDropOffSchema.safeParse(invalidDropOff);
  assertEquals(result.success, false);
});

// =============================================================================
// CreateNotificationSchema Tests
// =============================================================================

Deno.test('CreateNotificationSchema - accepts valid notification', () => {
  const validNotification = {
    user_id: VALID_UUID,
    type: 'disc_found',
    title: 'Your disc was found!',
    body: 'Someone found your disc at the park.',
    data: { disc_id: VALID_UUID },
  };
  const result = CreateNotificationSchema.safeParse(validNotification);
  assertEquals(result.success, true);
});

Deno.test('CreateNotificationSchema - rejects invalid type', () => {
  const invalidNotification = {
    user_id: VALID_UUID,
    type: 'invalid_type',
    title: 'Test',
    body: 'Test body',
  };
  const result = CreateNotificationSchema.safeParse(invalidNotification);
  assertEquals(result.success, false);
});

// =============================================================================
// LinkQrToDiscSchema Tests
// =============================================================================

Deno.test('LinkQrToDiscSchema - accepts valid request', () => {
  const validRequest = {
    qr_code: 'ABC123',
    disc_id: VALID_UUID,
  };
  const result = LinkQrToDiscSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test('LinkQrToDiscSchema - rejects missing qr_code', () => {
  const invalidRequest = {
    qr_code: '',
    disc_id: VALID_UUID,
  };
  const result = LinkQrToDiscSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

// =============================================================================
// UpdateOrderStatusSchema Tests
// =============================================================================

Deno.test('UpdateOrderStatusSchema - accepts valid status update', () => {
  const validUpdate = {
    printer_token: 'token123',
    status: 'shipped',
    tracking_number: '1Z999AA10123456784',
  };
  const result = UpdateOrderStatusSchema.safeParse(validUpdate);
  assertEquals(result.success, true);
});

Deno.test('UpdateOrderStatusSchema - accepts update without tracking_number', () => {
  const validUpdate = {
    printer_token: 'token123',
    status: 'printed',
  };
  const result = UpdateOrderStatusSchema.safeParse(validUpdate);
  assertEquals(result.success, true);
});

// =============================================================================
// SubmitDiscToCatalogSchema Tests
// =============================================================================

Deno.test('SubmitDiscToCatalogSchema - accepts valid submission', () => {
  const validSubmission = {
    manufacturer: 'Innova',
    mold: 'Destroyer',
    category: 'Distance Driver',
    speed: 12,
    glide: 5,
    turn: -1,
    fade: 3,
    stability: 'Overstable',
  };
  const result = SubmitDiscToCatalogSchema.safeParse(validSubmission);
  assertEquals(result.success, true);
});

Deno.test('SubmitDiscToCatalogSchema - accepts minimal submission', () => {
  const validSubmission = {
    manufacturer: 'Innova',
    mold: 'Destroyer',
  };
  const result = SubmitDiscToCatalogSchema.safeParse(validSubmission);
  assertEquals(result.success, true);
});

Deno.test('SubmitDiscToCatalogSchema - rejects missing manufacturer', () => {
  const invalidSubmission = {
    mold: 'Destroyer',
  };
  const result = SubmitDiscToCatalogSchema.safeParse(invalidSubmission);
  assertEquals(result.success, false);
});

// =============================================================================
// DismissNotificationSchema Tests
// =============================================================================

Deno.test('DismissNotificationSchema - accepts notification_id', () => {
  const validRequest = {
    notification_id: VALID_UUID,
  };
  const result = DismissNotificationSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test('DismissNotificationSchema - accepts dismiss_all', () => {
  const validRequest = {
    dismiss_all: true,
  };
  const result = DismissNotificationSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test('DismissNotificationSchema - rejects empty request', () => {
  const invalidRequest = {};
  const result = DismissNotificationSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test('DismissNotificationSchema - rejects dismiss_all false without notification_id', () => {
  const invalidRequest = {
    dismiss_all: false,
  };
  const result = DismissNotificationSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test('DismissNotificationSchema - accepts both notification_id and dismiss_all', () => {
  const validRequest = {
    notification_id: VALID_UUID,
    dismiss_all: true,
  };
  const result = DismissNotificationSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

// =============================================================================
// MarkNotificationReadSchema Tests
// =============================================================================

Deno.test('MarkNotificationReadSchema - accepts notification_id', () => {
  const validRequest = {
    notification_id: VALID_UUID,
  };
  const result = MarkNotificationReadSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test('MarkNotificationReadSchema - accepts mark_all', () => {
  const validRequest = {
    mark_all: true,
  };
  const result = MarkNotificationReadSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

Deno.test('MarkNotificationReadSchema - rejects empty request', () => {
  const invalidRequest = {};
  const result = MarkNotificationReadSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test('MarkNotificationReadSchema - rejects mark_all false without notification_id', () => {
  const invalidRequest = {
    mark_all: false,
  };
  const result = MarkNotificationReadSchema.safeParse(invalidRequest);
  assertEquals(result.success, false);
});

Deno.test('MarkNotificationReadSchema - accepts both notification_id and mark_all', () => {
  const validRequest = {
    notification_id: VALID_UUID,
    mark_all: true,
  };
  const result = MarkNotificationReadSchema.safeParse(validRequest);
  assertEquals(result.success, true);
});

// =============================================================================
// Simple ID Schemas Tests
// =============================================================================

Deno.test('MarkDiscRetrievedSchema - accepts valid UUID', () => {
  const result = MarkDiscRetrievedSchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('AcceptMeetupSchema - accepts valid UUID', () => {
  const result = AcceptMeetupSchema.safeParse({ proposal_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('DeclineMeetupSchema - accepts valid request with reason', () => {
  const result = DeclineMeetupSchema.safeParse({
    proposal_id: VALID_UUID,
    reason: 'Not available at that time',
  });
  assertEquals(result.success, true);
});

Deno.test('AbandonDiscSchema - accepts valid UUID', () => {
  const result = AbandonDiscSchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('SurrenderDiscSchema - accepts valid UUID', () => {
  const result = SurrenderDiscSchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('ClaimDiscSchema - accepts valid UUID', () => {
  const result = ClaimDiscSchema.safeParse({ disc_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('CompleteRecoverySchema - accepts valid UUID', () => {
  const result = CompleteRecoverySchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('RelinquishDiscSchema - accepts valid UUID', () => {
  const result = RelinquishDiscSchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('MarkRewardPaidSchema - accepts valid UUID', () => {
  const result = MarkRewardPaidSchema.safeParse({ recovery_event_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('UnlinkQrCodeSchema - accepts valid UUID', () => {
  const result = UnlinkQrCodeSchema.safeParse({ disc_id: VALID_UUID });
  assertEquals(result.success, true);
});

Deno.test('AssignQrCodeSchema - accepts valid qr_code', () => {
  const result = AssignQrCodeSchema.safeParse({ qr_code: 'ABC123' });
  assertEquals(result.success, true);
});

Deno.test('DeleteDiscSchema - accepts valid UUID', () => {
  const result = DeleteDiscSchema.safeParse({ disc_id: VALID_UUID });
  assertEquals(result.success, true);
});

// =============================================================================
// ValidateAddressSchema Tests
// =============================================================================

Deno.test('ValidateAddressSchema - accepts valid address', () => {
  const validAddress = {
    street_address: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = ValidateAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
});

Deno.test('ValidateAddressSchema - accepts address with street_address_2', () => {
  const validAddress = {
    street_address: '123 Main St',
    street_address_2: 'Apt 4',
    city: 'Portland',
    state: 'OR',
    postal_code: '97201',
  };
  const result = ValidateAddressSchema.safeParse(validAddress);
  assertEquals(result.success, true);
});

// =============================================================================
// Helper Functions Tests
// =============================================================================

Deno.test('validateRequest - returns success with data for valid input', () => {
  const result = validateRequest(ClaimDiscSchema, { disc_id: VALID_UUID });
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.data.disc_id, VALID_UUID);
  }
});

Deno.test('validateRequest - returns error for invalid input', () => {
  const result = validateRequest(ClaimDiscSchema, { disc_id: INVALID_UUID });
  assertEquals(result.success, false);
  if (!result.success) {
    assertExists(result.error);
  }
});

Deno.test('formatZodError - formats single error', () => {
  const result = ClaimDiscSchema.safeParse({ disc_id: INVALID_UUID });
  if (!result.success) {
    const message = formatZodError(result.error);
    assertEquals(message.includes('disc_id'), true);
  }
});

Deno.test('formatZodError - formats multiple errors', () => {
  const result = CreateDiscSchema.safeParse({});
  if (!result.success) {
    const message = formatZodError(result.error);
    assertEquals(message.includes(';'), true); // Multiple errors separated by ;
  }
});

Deno.test('formatZodError - formats error with empty path (refine error)', () => {
  // Refine errors have empty path
  const result = CreateStickerOrderSchema.safeParse({ quantity: 5 });
  if (!result.success) {
    const message = formatZodError(result.error);
    // Should not have a path prefix for refine errors
    assertEquals(message.includes('Either shipping_address_id or shipping_address is required'), true);
  }
});

Deno.test('validationErrorResponse - returns 400 Response', () => {
  const result = ClaimDiscSchema.safeParse({ disc_id: INVALID_UUID });
  if (!result.success) {
    const response = validationErrorResponse(result.error);
    assertEquals(response.status, 400);
    assertEquals(response.headers.get('Content-Type'), 'application/json');
  }
});

Deno.test('validationErrorResponse - includes error details in body', async () => {
  const result = ClaimDiscSchema.safeParse({ disc_id: INVALID_UUID });
  if (!result.success) {
    const response = validationErrorResponse(result.error);
    const body = await response.json();
    assertEquals(body.error, 'Validation failed');
    assertExists(body.message);
    assertExists(body.details);
  }
});

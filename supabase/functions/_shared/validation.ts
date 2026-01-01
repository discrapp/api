/**
 * Shared Zod Validation Module
 *
 * Provides Zod schemas for all edge function request bodies and
 * helper functions for validation and error responses.
 */

import { z } from 'npm:zod@3.24.1';

// =============================================================================
// Common / Reusable Schemas
// =============================================================================

/**
 * UUID schema for validating IDs
 */
export const UuidSchema = z.string().uuid();

/**
 * Shipping address schema (used in multiple functions)
 */
export const ShippingAddressSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  street_address: z.string().min(1, 'Street address is required'),
  street_address_2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postal_code: z.string().min(1, 'Postal code is required'),
  country: z.string().optional().default('US'),
});

/**
 * Flight numbers schema for disc golf discs
 */
export const FlightNumbersSchema = z.object({
  speed: z.number().min(1).max(14, 'Speed must be between 1 and 14'),
  glide: z.number().min(1).max(7, 'Glide must be between 1 and 7'),
  turn: z.number().min(-5).max(1, 'Turn must be between -5 and 1'),
  fade: z.number().min(0).max(5, 'Fade must be between 0 and 5'),
  stability: z.number().optional(),
});

/**
 * Notification types enum
 */
export const NotificationTypeSchema = z.enum([
  'disc_found',
  'meetup_proposed',
  'meetup_accepted',
  'meetup_declined',
  'disc_recovered',
]);

/**
 * Order status enum for update-order-status
 */
export const OrderStatusSchema = z.enum(['processing', 'printed', 'shipped', 'delivered']);

/**
 * Disc catalog category enum
 */
export const DiscCategorySchema = z.enum([
  'Distance Driver',
  'Control Driver',
  'Hybrid Driver',
  'Midrange',
  'Putter',
  'Approach Discs',
]);

/**
 * Disc stability enum
 */
export const DiscStabilitySchema = z.enum([
  'Very Overstable',
  'Overstable',
  'Stable',
  'Understable',
  'Very Understable',
]);

// =============================================================================
// Edge Function Request Body Schemas
// =============================================================================

/**
 * create-sticker-order request body
 */
export const CreateStickerOrderSchema = z
  .object({
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
    shipping_address_id: z.string().uuid().optional(),
    shipping_address: ShippingAddressSchema.optional(),
  })
  .refine((data) => data.shipping_address_id || data.shipping_address, {
    message: 'Either shipping_address_id or shipping_address is required',
  });

/**
 * propose-meetup request body
 */
export const ProposeMeetupSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
  location_name: z.string().min(1, 'Location name is required'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  proposed_datetime: z.string().datetime({ message: 'Invalid datetime format' }),
  message: z.string().optional(),
});

/**
 * report-found-disc request body
 */
export const ReportFoundDiscSchema = z.object({
  qr_code: z.string().min(1, 'QR code is required'),
  message: z.string().optional(),
});

/**
 * create-disc request body
 */
export const CreateDiscSchema = z.object({
  manufacturer: z.string().optional(),
  mold: z.string().min(1, 'Mold is required'),
  plastic: z.string().optional(),
  weight: z.number().positive().optional(),
  color: z.string().optional(),
  flight_numbers: FlightNumbersSchema,
  reward_amount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
  qr_code_id: z.string().uuid().optional(),
  ai_identification_log_id: z.string().uuid().optional(),
});

/**
 * update-disc request body
 */
export const UpdateDiscSchema = z.object({
  disc_id: z.string().uuid('Invalid disc_id'),
  manufacturer: z.string().optional(),
  mold: z.string().optional(),
  plastic: z.string().optional(),
  weight: z.number().positive().optional(),
  color: z.string().optional(),
  flight_numbers: FlightNumbersSchema.optional(),
  reward_amount: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

/**
 * register-push-token request body
 */
export const RegisterPushTokenSchema = z.object({
  push_token: z
    .string()
    .min(1, 'Push token is required')
    .refine(
      (token) => token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['),
      'Invalid push token format'
    ),
});

/**
 * save-default-address request body
 */
export const SaveDefaultAddressSchema = z.object({
  address_id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required'),
  street_address: z.string().min(1, 'Street address is required'),
  street_address_2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postal_code: z.string().min(1, 'Postal code is required'),
  country: z.string().optional().default('US'),
});

/**
 * mark-disc-retrieved request body
 */
export const MarkDiscRetrievedSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * accept-meetup request body
 */
export const AcceptMeetupSchema = z.object({
  proposal_id: z.string().uuid('Invalid proposal_id'),
});

/**
 * decline-meetup request body
 */
export const DeclineMeetupSchema = z.object({
  proposal_id: z.string().uuid('Invalid proposal_id'),
  reason: z.string().optional(),
});

/**
 * create-drop-off request body
 */
export const CreateDropOffSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
  photo_url: z.string().url('Invalid photo URL'),
  latitude: z.number(),
  longitude: z.number(),
  location_notes: z.string().optional(),
});

/**
 * abandon-disc request body
 */
export const AbandonDiscSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * surrender-disc request body
 */
export const SurrenderDiscSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * claim-disc request body
 */
export const ClaimDiscSchema = z.object({
  disc_id: z.string().uuid('Invalid disc_id'),
});

/**
 * complete-recovery request body
 */
export const CompleteRecoverySchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * relinquish-disc request body
 */
export const RelinquishDiscSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * mark-reward-paid request body
 */
export const MarkRewardPaidSchema = z.object({
  recovery_event_id: z.string().uuid('Invalid recovery_event_id'),
});

/**
 * validate-address request body
 */
export const ValidateAddressSchema = z.object({
  street_address: z.string().min(1, 'Street address is required'),
  street_address_2: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  postal_code: z.string().min(1, 'Postal code is required'),
});

/**
 * create-notification request body
 */
export const CreateNotificationSchema = z.object({
  user_id: z.string().uuid('Invalid user_id'),
  type: NotificationTypeSchema,
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  data: z.record(z.unknown()).optional(),
});

/**
 * link-qr-to-disc request body
 */
export const LinkQrToDiscSchema = z.object({
  qr_code: z.string().min(1, 'QR code is required'),
  disc_id: z.string().uuid('Invalid disc_id'),
});

/**
 * unlink-qr-code request body
 */
export const UnlinkQrCodeSchema = z.object({
  disc_id: z.string().uuid('Invalid disc_id'),
});

/**
 * assign-qr-code request body
 */
export const AssignQrCodeSchema = z.object({
  qr_code: z.string().min(1, 'QR code is required'),
});

/**
 * update-order-status request body (POST)
 */
export const UpdateOrderStatusSchema = z.object({
  printer_token: z.string().min(1, 'Printer token is required'),
  status: OrderStatusSchema,
  tracking_number: z.string().optional(),
});

/**
 * submit-disc-to-catalog request body
 */
export const SubmitDiscToCatalogSchema = z.object({
  manufacturer: z.string().min(1, 'Manufacturer is required'),
  mold: z.string().min(1, 'Mold is required'),
  category: DiscCategorySchema.optional(),
  speed: z.number().optional(),
  glide: z.number().optional(),
  turn: z.number().optional(),
  fade: z.number().optional(),
  stability: DiscStabilitySchema.optional(),
});

/**
 * delete-disc request body
 */
export const DeleteDiscSchema = z.object({
  disc_id: z.string().uuid('Invalid disc_id'),
});

/**
 * dismiss-notification request body
 */
export const DismissNotificationSchema = z
  .object({
    notification_id: z.string().uuid().optional(),
    dismiss_all: z.boolean().optional(),
  })
  .refine((data) => data.notification_id || data.dismiss_all, {
    message: 'Either notification_id or dismiss_all is required',
  });

/**
 * mark-notification-read request body
 */
export const MarkNotificationReadSchema = z
  .object({
    notification_id: z.string().uuid().optional(),
    mark_all: z.boolean().optional(),
  })
  .refine((data) => data.notification_id || data.mark_all, {
    message: 'Either notification_id or mark_all is required',
  });

// =============================================================================
// Type Exports
// =============================================================================

export type ShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type FlightNumbers = z.infer<typeof FlightNumbersSchema>;
export type NotificationType = z.infer<typeof NotificationTypeSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type DiscCategory = z.infer<typeof DiscCategorySchema>;
export type DiscStability = z.infer<typeof DiscStabilitySchema>;

export type CreateStickerOrderRequest = z.infer<typeof CreateStickerOrderSchema>;
export type ProposeMeetupRequest = z.infer<typeof ProposeMeetupSchema>;
export type ReportFoundDiscRequest = z.infer<typeof ReportFoundDiscSchema>;
export type CreateDiscRequest = z.infer<typeof CreateDiscSchema>;
export type UpdateDiscRequest = z.infer<typeof UpdateDiscSchema>;
export type RegisterPushTokenRequest = z.infer<typeof RegisterPushTokenSchema>;
export type SaveDefaultAddressRequest = z.infer<typeof SaveDefaultAddressSchema>;
export type MarkDiscRetrievedRequest = z.infer<typeof MarkDiscRetrievedSchema>;
export type AcceptMeetupRequest = z.infer<typeof AcceptMeetupSchema>;
export type DeclineMeetupRequest = z.infer<typeof DeclineMeetupSchema>;
export type CreateDropOffRequest = z.infer<typeof CreateDropOffSchema>;
export type AbandonDiscRequest = z.infer<typeof AbandonDiscSchema>;
export type SurrenderDiscRequest = z.infer<typeof SurrenderDiscSchema>;
export type ClaimDiscRequest = z.infer<typeof ClaimDiscSchema>;
export type CompleteRecoveryRequest = z.infer<typeof CompleteRecoverySchema>;
export type RelinquishDiscRequest = z.infer<typeof RelinquishDiscSchema>;
export type MarkRewardPaidRequest = z.infer<typeof MarkRewardPaidSchema>;
export type ValidateAddressRequest = z.infer<typeof ValidateAddressSchema>;
export type CreateNotificationRequest = z.infer<typeof CreateNotificationSchema>;
export type LinkQrToDiscRequest = z.infer<typeof LinkQrToDiscSchema>;
export type UnlinkQrCodeRequest = z.infer<typeof UnlinkQrCodeSchema>;
export type AssignQrCodeRequest = z.infer<typeof AssignQrCodeSchema>;
export type UpdateOrderStatusRequest = z.infer<typeof UpdateOrderStatusSchema>;
export type SubmitDiscToCatalogRequest = z.infer<typeof SubmitDiscToCatalogSchema>;
export type DeleteDiscRequest = z.infer<typeof DeleteDiscSchema>;
export type DismissNotificationRequest = z.infer<typeof DismissNotificationSchema>;
export type MarkNotificationReadRequest = z.infer<typeof MarkNotificationReadSchema>;

// =============================================================================
// Validation Helper Functions
// =============================================================================

/**
 * Result type for validation operations
 */
export type ValidationResult<T> =
  | { success: true; data: T; error?: undefined }
  | { success: false; data?: undefined; error: z.ZodError };

/**
 * Validates data against a Zod schema
 *
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns A ValidationResult with either the parsed data or a ZodError
 *
 * @example
 * ```ts
 * const result = validateRequest(CreateDiscSchema, body);
 * if (!result.success) {
 *   return validationErrorResponse(result.error);
 * }
 * const validData = result.data;
 * ```
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Formats a ZodError into a user-friendly error message
 *
 * @param error - The ZodError to format
 * @returns A formatted error message string
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.length > 0 ? `${err.path.join('.')}: ` : '';
      return `${path}${err.message}`;
    })
    .join('; ');
}

/**
 * Creates a 400 Bad Request Response from a ZodError
 *
 * @param error - The ZodError to convert to a response
 * @returns A Response object with status 400 and error details
 *
 * @example
 * ```ts
 * const result = validateRequest(CreateDiscSchema, body);
 * if (!result.success) {
 *   return validationErrorResponse(result.error);
 * }
 * ```
 */
export function validationErrorResponse(error: z.ZodError): Response {
  const message = formatZodError(error);
  return new Response(
    JSON.stringify({
      error: 'Validation failed',
      message,
      details: error.errors,
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

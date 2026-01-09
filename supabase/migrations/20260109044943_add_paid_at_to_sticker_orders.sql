-- Add paid_at column to track when payment was received
ALTER TABLE sticker_orders
ADD COLUMN paid_at TIMESTAMPTZ;

-- Comment for documentation
COMMENT ON COLUMN sticker_orders.paid_at IS 'Timestamp when payment was received via Stripe';

-- Add slack_message_ts column to track Slack notification messages
-- This allows us to update the message when the plastic is approved/rejected

ALTER TABLE plastic_types
ADD COLUMN slack_message_ts text;

COMMENT ON COLUMN plastic_types.slack_message_ts IS 'Slack message timestamp for updating the notification when status changes';

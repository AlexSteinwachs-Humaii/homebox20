-- +goose Up
-- Goose history owns this one-time rollout, including explicitly saved themes.
-- Keep every other preference; tolerate legacy null/empty settings.
UPDATE users
SET settings = jsonb_set(
    CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
    '{theme}', '"claude"'::jsonb, true
);

-- +goose Down
-- Intentionally irreversible: original themes cannot be reconstructed. A down
-- migration must not reset a user's alternate theme chosen after this rollout.

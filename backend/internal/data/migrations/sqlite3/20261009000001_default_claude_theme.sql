-- +goose Up
-- Goose history owns this one-time rollout, including explicitly saved themes.
-- Keep every other preference; tolerate legacy null/empty settings.
UPDATE users
SET settings = json_set(
    CASE WHEN json_valid(settings) THEN
        CASE WHEN json_type(settings) = 'object' THEN settings ELSE '{}' END
    ELSE '{}' END,
    '$.theme', 'claude'
);

-- +goose Down
-- Intentionally irreversible: original themes cannot be reconstructed. A down
-- migration must not reset a user's alternate theme chosen after this rollout.

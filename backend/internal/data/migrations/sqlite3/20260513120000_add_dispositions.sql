-- +goose Up
-- Independent collection history: no entity, entity-type, user or active-file FKs.
CREATE TABLE dispositions (
    id uuid NOT NULL PRIMARY KEY,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    name text NOT NULL,
    asset_id integer NOT NULL,
    serial_number text NOT NULL DEFAULT '',
    manufacturer text NOT NULL DEFAULT '',
    model_number text NOT NULL DEFAULT '',
    quantity real NOT NULL,
    purchase_price real NOT NULL DEFAULT 0,
    purchase_date datetime NULL,
    purchase_from text NOT NULL DEFAULT '',
    insured boolean NOT NULL DEFAULT false,
    is_location boolean NOT NULL,
    parent_name text NOT NULL DEFAULT '',
    disposition text NOT NULL CHECK (disposition IN ('sold', 'destroyed', 'given_away', 'donated', 'lost_or_stolen')),
    disposition_date datetime NOT NULL,
    recorder_id uuid NOT NULL,
    recorder_name text NOT NULL,
    recipient text NOT NULL DEFAULT '',
    value real NULL,
    notes text NOT NULL DEFAULT '',
    group_id uuid NOT NULL,
    CONSTRAINT dispositions_groups_dispositions FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);
CREATE INDEX disposition_group_id ON dispositions(group_id);

CREATE TABLE disposition_attachments (
    id uuid NOT NULL PRIMARY KEY,
    created_at datetime NOT NULL,
    updated_at datetime NOT NULL,
    type text NOT NULL CHECK (type IN ('photo', 'receipt')),
    title text NOT NULL DEFAULT '',
    path text NOT NULL,
    mime_type text NOT NULL DEFAULT 'application/octet-stream',
    disposition_id uuid NOT NULL,
    CONSTRAINT disposition_attachments_dispositions_attachments FOREIGN KEY (disposition_id) REFERENCES dispositions(id) ON DELETE CASCADE
);
CREATE INDEX dispositionattachment_disposition_id ON disposition_attachments(disposition_id);
CREATE UNIQUE INDEX dispositionattachment_path ON disposition_attachments(path);

-- Legacy sold entities remain untouched in active inventory.

-- +goose Down
DROP TABLE disposition_attachments;
DROP TABLE dispositions;

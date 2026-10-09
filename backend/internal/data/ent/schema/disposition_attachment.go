package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/schema/mixins"
)

// DispositionAttachment describes an independently retained blob, never an
// active Attachment. A photo row is the primary photo; receipts are unbounded.
// Its collection ownership is inherited through its required disposition.
type DispositionAttachment struct{ ent.Schema }

func (DispositionAttachment) Mixin() []ent.Mixin { return []ent.Mixin{mixins.BaseMixin{}} }

func (DispositionAttachment) Fields() []ent.Field {
	return []ent.Field{
		field.UUID("disposition_id", uuid.UUID{}).Immutable(),
		field.Enum("type").Values("photo", "receipt").Immutable(),
		field.String("title").Default("").Immutable(),
		field.String("path").NotEmpty().Immutable(),
		field.String("mime_type").Default("application/octet-stream").Immutable(),
	}
}

func (DispositionAttachment) Edges() []ent.Edge {
	return []ent.Edge{edge.From("disposition", Disposition.Type).Ref("attachments").Field("disposition_id").Unique().Required().Immutable()}
}

func (DispositionAttachment) Indexes() []ent.Index {
	return []ent.Index{index.Fields("disposition_id"), index.Fields("path").Unique()}
}

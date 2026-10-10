package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/schema/mixins"
)

// Disposition is a historical snapshot owned only by the collection. Identity,
// hierarchy and recorder fields deliberately have no entity, type or user edges.
// Dates and monetary values follow Entity conventions (time.Time and float64).
type Disposition struct{ ent.Schema }

func (Disposition) Mixin() []ent.Mixin {
	return []ent.Mixin{mixins.BaseMixin{}, GroupMixin{ref: "dispositions", field: "group_id"}}
}

func (Disposition) Fields() []ent.Field {
	return []ent.Field{
		field.String("name").NotEmpty().MaxLen(255).Immutable(),
		field.Int64("asset_id").Immutable(),
		field.String("serial_number").Default("").MaxLen(255).Immutable(),
		field.String("manufacturer").Default("").MaxLen(255).Immutable(),
		field.String("model_number").Default("").MaxLen(255).Immutable(),
		field.Float("quantity").Immutable(),
		field.Float("purchase_price").Default(0).Immutable(),
		field.Time("purchase_date").Optional().Nillable().Immutable(),
		field.String("purchase_from").Default("").Immutable(),
		field.Bool("insured").Default(false).Immutable(),
		field.Bool("is_location").Immutable(),
		field.String("parent_name").Default("").MaxLen(255).Immutable(),
		field.Enum("disposition").Values("sold", "destroyed", "given_away", "donated", "lost_or_stolen").Immutable(),
		field.Time("disposition_date").Immutable(),
		field.UUID("recorder_id", uuid.UUID{}).Immutable(),
		field.String("recorder_name").NotEmpty().Immutable(),
		field.String("recipient").Default("").Immutable(),
		field.Float("value").Optional().Nillable().Immutable(),
		field.String("notes").Default("").MaxRuneLen(10000).Immutable(),
	}
}

func (Disposition) Edges() []ent.Edge {
	return []ent.Edge{edge.To("attachments", DispositionAttachment.Type).Annotations(entsql.Annotation{OnDelete: entsql.Cascade})}
}

func (Disposition) Indexes() []ent.Index {
	return []ent.Index{index.Fields("group_id")}
}

package repo

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entity"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/entitytype"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/group"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/maintenanceentry"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/predicate"
	"github.com/sysadminsmedia/homebox/backend/internal/data/types"
)

// CareRow is one reason an item needs attention, not a distinct item.
// Kind is overdue, warranty, missing_photo, or coming_up. MaintenanceID is
// present only for maintenance rows; LocationPath contains location ancestors.
type CareRow struct {
	Kind            string       `json:"kind" enums:"overdue,warranty,missing_photo,coming_up"`
	ItemID          uuid.UUID    `json:"itemId"`
	ItemName        string       `json:"itemName"`
	LocationPath    []EntityPath `json:"locationPath"`
	MaintenanceID   *uuid.UUID   `json:"maintenanceId,omitempty" extensions:"x-nullable,x-omitempty"`
	Name            string       `json:"name"`
	Description     string       `json:"description"`
	ScheduledDate   types.Date   `json:"scheduledDate"`
	WarrantyExpires types.Date   `json:"warrantyExpires"`
	PurchasePrice   float64      `json:"purchasePrice,string"`
	DaysLate        int          `json:"daysLate"`
	DaysRemaining   int          `json:"daysRemaining"`
}

type CareQueue struct {
	NeedsYou []CareRow `json:"needsYou"`
	ComingUp []CareRow `json:"comingUp"`
	Count    int       `json:"count"`
}

type CareRepository struct {
	db *ent.Client
}

func (r *CareRepository) Get(ctx context.Context, gid uuid.UUID) (CareQueue, error) {
	return r.getAt(ctx, gid, time.Now().UTC())
}

// Dates in storage are UTC calendar days. Using UTC midnight also makes
// boundaries and days-late independent of DST and the server's local timezone.
func (r *CareRepository) getAt(ctx context.Context, gid uuid.UUID, now time.Time) (CareQueue, error) {
	today := types.DateFromTime(now.UTC()).Time()
	out := CareQueue{NeedsYou: []CareRow{}, ComingUp: []CareRow{}}
	activeItems := []predicate.Entity{
		entity.HasGroupWith(group.ID(gid)), entity.Archived(false),
		entity.Or(entity.Not(entity.HasEntityType()), entity.HasEntityTypeWith(entitytype.IsLocation(false))),
	}
	paths := map[uuid.UUID][]EntityPath{}
	rowFor := func(item *ent.Entity, kind string) (CareRow, error) {
		path, ok := paths[item.ID]
		if !ok {
			var err error
			path, err = r.locationPath(ctx, gid, item)
			if err != nil {
				return CareRow{}, err
			}
			paths[item.ID] = path
		}
		return CareRow{Kind: kind, ItemID: item.ID, ItemName: item.Name, LocationPath: path, PurchasePrice: item.PurchasePrice}, nil
	}
	entries, err := r.db.MaintenanceEntry.Query().Where(
		maintenanceentry.HasEntityWith(activeItems...),
		maintenanceentry.Or(maintenanceentry.DateIsNil(), maintenanceentry.DateEQ(time.Time{})),
		maintenanceentry.ScheduledDateGT(time.Time{}),
	).WithEntity().Order(maintenanceentry.ByScheduledDate(), maintenanceentry.ByID()).All(ctx)
	if err != nil {
		return out, err
	}
	for _, entry := range entries {
		row, err := rowFor(entry.Edges.Entity, "coming_up")
		if err != nil {
			return out, err
		}
		row.MaintenanceID = &entry.ID
		row.Name, row.Description = entry.Name, entry.Description
		row.ScheduledDate = types.DateFromDBTime(entry.ScheduledDate)
		if row.ScheduledDate.Time().Before(today) {
			row.Kind = "overdue"
			row.DaysLate = int(today.Sub(row.ScheduledDate.Time()).Hours() / 24)
			out.NeedsYou = append(out.NeedsYou, row)
		} else {
			out.ComingUp = append(out.ComingUp, row)
		}
	}
	warranties, err := r.db.Entity.Query().Where(activeItems...).Where(
		entity.LifetimeWarranty(false), entity.WarrantyExpiresGT(today), entity.WarrantyExpiresLTE(today.AddDate(0, 0, 30)),
	).Order(entity.ByWarrantyExpires(), entity.ByID()).All(ctx)
	if err != nil {
		return out, err
	}
	for _, item := range warranties {
		row, err := rowFor(item, "warranty")
		if err != nil {
			return out, err
		}
		row.WarrantyExpires = types.DateFromDBTime(item.WarrantyExpires)
		row.DaysRemaining = int(row.WarrantyExpires.Time().Sub(today).Hours() / 24)
		out.NeedsYou = append(out.NeedsYou, row)
	}
	missingPhotos, err := r.db.Entity.Query().Where(activeItems...).Where(withoutPrimaryPhoto()).Order(entity.ByName(), entity.ByID()).All(ctx)
	if err != nil {
		return out, err
	}
	for _, item := range missingPhotos {
		row, err := rowFor(item, "missing_photo")
		if err != nil {
			return out, err
		}
		out.NeedsYou = append(out.NeedsYou, row)
	}
	out.Count = len(out.NeedsYou)
	return out, nil
}

// Walk only group-owned ancestors, with the same depth guard as entity helpers.
// Items can contain other items; those ancestors are not locations.
func (r *CareRepository) locationPath(ctx context.Context, gid uuid.UUID, item *ent.Entity) ([]EntityPath, error) {
	path := []EntityPath{}
	cur := item
	seen := map[uuid.UUID]bool{item.ID: true}
	for depth := 0; depth < maxAncestorDepth; depth++ {
		parent, err := cur.QueryParent().Where(entity.HasGroupWith(group.ID(gid))).WithEntityType().Only(ctx)
		if ent.IsNotFound(err) {
			break
		}
		if err != nil {
			return nil, err
		}
		if seen[parent.ID] {
			break
		}
		seen[parent.ID] = true
		if parent.Edges.EntityType != nil && parent.Edges.EntityType.IsLocation {
			path = append(path, EntityPath{ID: parent.ID, Name: parent.Name, Type: EntityPathTypeLocation})
		}
		cur = parent
	}
	for i, j := 0, len(path)-1; i < j; i, j = i+1, j-1 {
		path[i], path[j] = path[j], path[i]
	}
	return path, nil
}

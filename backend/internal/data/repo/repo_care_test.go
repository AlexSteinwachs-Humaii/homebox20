package repo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/attachment"
	"github.com/sysadminsmedia/homebox/backend/internal/data/types"
)

func TestCareQueue(t *testing.T) {
	ctx := context.Background()
	today := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	g, err := tRepos.Groups.GroupCreate(ctx, "Care", uuid.Nil)
	require.NoError(t, err)
	other, err := tRepos.Groups.GroupCreate(ctx, "Other Care", uuid.Nil)
	require.NoError(t, err)
	itemType, err := tRepos.EntityTypes.GetDefault(ctx, g.ID, false)
	require.NoError(t, err)
	placeType, err := tRepos.EntityTypes.GetDefault(ctx, g.ID, true)
	require.NoError(t, err)
	create := func(name string, gid uuid.UUID, photo bool) *ent.Entity {
		et, err := tRepos.EntityTypes.GetDefault(ctx, gid, false)
		require.NoError(t, err)
		e, err := tClient.Entity.Create().SetName(name).SetGroupID(gid).SetEntityTypeID(et.ID).Save(ctx)
		require.NoError(t, err)
		if photo {
			_, err = tClient.Attachment.Create().SetEntity(e).SetType(attachment.TypePhoto).SetPrimary(true).Save(ctx)
			require.NoError(t, err)
		}
		return e
	}
	schedule := func(e *ent.Entity, days int, completed bool) *ent.MaintenanceEntry {
		q := tClient.MaintenanceEntry.Create().SetEntity(e).SetName("Replace filter").SetDescription("replace every 90 days").SetScheduledDate(today.AddDate(0, 0, days))
		if completed {
			q.SetDate(today)
		}
		m, err := q.Save(ctx)
		require.NoError(t, err)
		return m
	}
	// One item contributes three independent needs-you rows, plus another overdue.
	item := create("Drill", g.ID, false)
	item, err = item.Update().SetEntityTypeID(itemType.ID).SetWarrantyExpires(today.AddDate(0, 0, 12)).SetPurchasePrice(189).Save(ctx)
	require.NoError(t, err)
	place := create("Garage", g.ID, false)
	place, err = place.Update().SetEntityTypeID(placeType.ID).SetWarrantyExpires(today.AddDate(0, 0, 5)).Save(ctx)
	require.NoError(t, err)
	container := create("Tool box", g.ID, true)
	_, err = container.Update().SetParent(place).Save(ctx)
	require.NoError(t, err)
	_, err = item.Update().SetParent(container).Save(ctx)
	require.NoError(t, err)
	overdue := schedule(item, -6, false)
	// Zero, as well as SQL NULL, is the existing incomplete representation.
	second := schedule(item, -2, false)
	_, err = second.Update().SetDate(time.Time{}).Save(ctx)
	require.NoError(t, err)
	schedule(item, -5, true)
	upcoming := schedule(item, 0, false)
	schedule(item, 3, false)
	// No schedule and completed-only records are not overdue.
	_, err = tClient.MaintenanceEntry.Create().SetEntity(item).SetName("Unscheduled").Save(ctx)
	require.NoError(t, err)
	// Exact warranty boundaries: tomorrow and day 30 included, today and day 31 not.
	for _, days := range []int{-1, 0, 1, 30, 31} {
		e := create("Warranty", g.ID, true)
		_, err = e.Update().SetWarrantyExpires(today.AddDate(0, 0, days)).Save(ctx)
		require.NoError(t, err)
	}
	lifetime := create("Lifetime", g.ID, true)
	_, err = lifetime.Update().SetLifetimeWarranty(true).SetWarrantyExpires(today.AddDate(0, 0, 10)).Save(ctx)
	require.NoError(t, err)
	archived := create("Archived", g.ID, false)
	_, err = archived.Update().SetArchived(true).SetWarrantyExpires(today.AddDate(0, 0, 10)).Save(ctx)
	require.NoError(t, err)
	schedule(archived, -4, false)
	schedule(place, -4, false)
	foreign := create("Foreign", other.ID, false)
	_, err = foreign.Update().SetWarrantyExpires(today.AddDate(0, 0, 10)).Save(ctx)
	require.NoError(t, err)
	schedule(foreign, -4, false)
	schedule(foreign, 2, false)
	// A non-primary photo and a primary non-photo do not satisfy primary photo.
	noPrimary := create("No primary", g.ID, false)
	_, err = tClient.Attachment.Create().SetEntity(noPrimary).SetType(attachment.TypePhoto).Save(ctx)
	require.NoError(t, err)
	_, err = tClient.Attachment.Create().SetEntity(noPrimary).SetType(attachment.TypeManual).SetPrimary(true).Save(ctx)
	require.NoError(t, err)

	// UTC semantics stay stable even when the process supplies another zone.
	out, err := tRepos.Care.getAt(ctx, g.ID, today.Add(12*time.Hour).In(time.FixedZone("west", -7*3600)))
	require.NoError(t, err)
	require.Equal(t, 7, out.Count) // 2 overdue + 3 warranties + 2 missing photos
	require.Len(t, out.NeedsYou, out.Count)
	require.Len(t, out.ComingUp, 2)
	require.Equal(t, upcoming.ID, *out.ComingUp[0].MaintenanceID)
	require.Equal(t, overdue.ID, *out.NeedsYou[0].MaintenanceID)
	require.Equal(t, 6, out.NeedsYou[0].DaysLate)
	require.Equal(t, "Replace filter", out.NeedsYou[0].Name)
	require.Equal(t, "Drill", out.NeedsYou[0].ItemName)
	require.Equal(t, "replace every 90 days", out.NeedsYou[0].Description)
	require.Equal(t, 0, out.ComingUp[0].DaysRemaining)
	require.Equal(t, 3, out.ComingUp[1].DaysRemaining)
	require.Equal(t, []EntityPath{{ID: place.ID, Name: "Garage", Type: EntityPathTypeLocation}}, out.NeedsYou[0].LocationPath)
	require.Equal(t, []string{"overdue", "overdue", "warranty", "warranty", "warranty", "missing_photo", "missing_photo"}, func() []string {
		kinds := []string{}
		for _, row := range out.NeedsYou {
			kinds = append(kinds, row.Kind)
		}
		return kinds
	}())
	for _, row := range append(out.NeedsYou, out.ComingUp...) {
		require.NotEqual(t, foreign.ID, row.ItemID)
		require.NotEqual(t, archived.ID, row.ItemID)
		require.NotEqual(t, place.ID, row.ItemID)
		require.NotEmpty(t, row.Name)
		if row.Kind == "warranty" || row.Kind == "missing_photo" {
			require.Equal(t, row.ItemName, row.Name)
		}
		if row.Kind == "warranty" && row.ItemID == item.ID {
			require.Equal(t, 12, row.DaysRemaining)
			require.Equal(t, 189.0, row.PurchasePrice)
		}
	}
	empty, err := tRepos.Care.getAt(ctx, uuid.New(), today)
	require.NoError(t, err)
	require.Zero(t, empty.Count)
	require.NotNil(t, empty.NeedsYou)
	require.NotNil(t, empty.ComingUp)
}

func TestCareMaintenanceActions(t *testing.T) {
	ctx := context.Background()
	today := time.Date(2026, 10, 9, 0, 0, 0, 0, time.UTC)
	g, err := tRepos.Groups.GroupCreate(ctx, "Care actions", uuid.Nil)
	require.NoError(t, err)
	et, err := tRepos.EntityTypes.GetDefault(ctx, g.ID, false)
	require.NoError(t, err)
	item, err := tClient.Entity.Create().SetName("Filter").SetGroupID(g.ID).SetEntityTypeID(et.ID).Save(ctx)
	require.NoError(t, err)
	_, err = tClient.Attachment.Create().SetEntity(item).SetType(attachment.TypePhoto).SetPrimary(true).Save(ctx)
	require.NoError(t, err)
	create := func(days int) MaintenanceEntry {
		m, err := tRepos.MaintEntry.Create(ctx, g.ID, item.ID, MaintenanceEntryCreate{
			Name: "Filter", Description: "replace every 90 days", Cost: 42.5,
			ScheduledDate: types.DateFromTime(today.AddDate(0, 0, days)),
		})
		require.NoError(t, err)
		return m
	}
	overdue, future := create(-6), create(20)
	before, err := tRepos.Care.getAt(ctx, g.ID, today)
	require.NoError(t, err)
	require.Equal(t, 1, before.Count)
	done, err := tRepos.MaintEntry.Update(ctx, g.ID, overdue.ID, MaintenanceEntryUpdate{
		Name: overdue.Name, Description: overdue.Description, Cost: overdue.Cost,
		ScheduledDate: overdue.ScheduledDate, CompletedDate: types.DateFromTime(today),
	})
	require.NoError(t, err)
	require.Equal(t, today, done.CompletedDate.Time())
	require.Equal(t, overdue.ScheduledDate, done.ScheduledDate)
	snoozed, err := tRepos.MaintEntry.Update(ctx, g.ID, future.ID, MaintenanceEntryUpdate{
		Name: future.Name, Description: future.Description, Cost: future.Cost,
		ScheduledDate: types.DateFromTime(future.ScheduledDate.Time().AddDate(0, 0, 7)),
	})
	require.NoError(t, err)
	require.True(t, snoozed.CompletedDate.Time().IsZero())
	require.Equal(t, today.AddDate(0, 0, 27), snoozed.ScheduledDate.Time())
	for _, day := range []time.Time{today, today.AddDate(0, 0, 1)} {
		after, err := tRepos.Care.getAt(ctx, g.ID, day)
		require.NoError(t, err)
		require.Equal(t, before.Count-1, after.Count)
		require.Empty(t, after.NeedsYou)
		require.Len(t, after.ComingUp, 1)
		require.Equal(t, future.ID, *after.ComingUp[0].MaintenanceID)
	}
	log, err := tRepos.MaintEntry.GetMaintenanceByItemID(ctx, g.ID, item.ID, MaintenanceFilters{})
	require.NoError(t, err)
	require.Len(t, log, 2) // Description is not a recurrence rule: no next entry.
	for _, m := range log {
		require.Equal(t, 42.5, m.Cost)
		require.Equal(t, "replace every 90 days", m.Description)
	}
}

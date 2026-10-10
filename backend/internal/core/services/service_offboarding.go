package services

import (
	"errors"
	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent/disposition"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/validate"
	"math"
	"strings"
	"time"
)

// OffboardingService orchestrates complete-quantity inventory removal. Public
// authorization and input decoding belong to the API story, not this service.
type OffboardingService struct{ repos *repo.AllRepos }

func (s *OffboardingService) Preview(ctx Context, root uuid.UUID) (repo.OffboardingPreview, error) {
	return s.repos.Entities.PreviewOffboarding(ctx, ctx.GID, root)
}

func (s *OffboardingService) Complete(ctx Context, root uuid.UUID, confirmation string, details repo.DispositionSnapshot) ([]uuid.UUID, error) {
	details.RecorderID = ctx.UID
	details.RecorderName = ""
	if ctx.User != nil {
		details.RecorderName = ctx.User.Name
		if details.RecorderName == "" {
			details.RecorderName = ctx.User.Email
		}
	}
	return s.repos.Entities.Offboard(ctx, ctx.GID, root, confirmation, details)
}

// OffboardingRequest contains only user-supplied disposition details, not tenant,
// recorder, quantity or client counts. Value absence is distinct from zero.
type OffboardingRequest struct {
	Confirmation string   `json:"confirmation" validate:"required,len=64,hexadecimal"`
	Disposition  string   `json:"disposition" validate:"required,oneof=sold destroyed given_away donated lost_or_stolen" enums:"sold,destroyed,given_away,donated,lost_or_stolen"`
	Date         string   `json:"date" validate:"required" example:"2026-10-09"`
	Notes        string   `json:"notes" validate:"max=10000"`
	Recipient    string   `json:"recipient" validate:"max=1000"`
	Value        *float64 `json:"value,omitempty" extensions:"x-nullable" minimum:"0"`
}

type OffboardingResult struct {
	RecordIDs []uuid.UUID `json:"recordIds"`
	Completed int         `json:"completed"`
}

func (r OffboardingRequest) Validate() error {
	if err := validate.Check(r); err != nil {
		return err
	}
	date, err := time.Parse("2006-01-02", r.Date)
	if err != nil || date.Year() < 1 {
		return errors.New("date must be a valid calendar date (YYYY-MM-DD)")
	}
	switch r.Disposition {
	case "sold", "given_away", "donated":
		if strings.TrimSpace(r.Recipient) == "" {
			return errors.New("recipient is required for sold, given_away and donated")
		}
	}
	if r.Value != nil && (math.IsNaN(*r.Value) || math.IsInf(*r.Value, 0) || *r.Value < 0) {
		return errors.New("value must be a finite non-negative number")
	}
	return nil
}

func (s *OffboardingService) CompleteRequest(ctx Context, root uuid.UUID, request OffboardingRequest) (OffboardingResult, error) {
	if err := request.Validate(); err != nil {
		return OffboardingResult{}, err
	}
	date, _ := time.Parse("2006-01-02", request.Date)
	ids, err := s.Complete(ctx, root, request.Confirmation, repo.DispositionSnapshot{
		Disposition: disposition.Disposition(request.Disposition), DispositionDate: date,
		Notes: request.Notes, Recipient: request.Recipient, Value: request.Value,
	})
	if err != nil {
		return OffboardingResult{}, err
	}
	return OffboardingResult{RecordIDs: ids, Completed: len(ids)}, nil
}

package services

import (
	"github.com/google/uuid"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
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

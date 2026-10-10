package v1

import (
	"errors"
	"net/http"

	"github.com/hay-kot/httpkit/errchain"
	"github.com/hay-kot/httpkit/server"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services"
	"github.com/sysadminsmedia/homebox/backend/internal/data/ent"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/sys/validate"
	"github.com/sysadminsmedia/homebox/backend/internal/web/adapters"
)

func dispositionRequiredHandler() errchain.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		return validate.NewRequestError(errors.New("a disposition is required; preview GET /api/v1/entities/{id}/offboarding, then confirm POST /api/v1/entities/{id}/offboarding for each item or place"), http.StatusConflict)
	}
}

func offboardingError(err error) error {
	switch {
	case ent.IsNotFound(err):
		return validate.NewRequestError(errors.New("entity not found"), http.StatusNotFound)
	case errors.Is(err, repo.ErrOffboardingConfirmationChanged):
		return validate.NewRequestError(err, http.StatusConflict)
	default:
		// Storage/SQL errors may contain private paths or mutation details.
		return validate.NewRequestError(errors.New("offboarding could not be completed; refresh the preview and retry"), http.StatusInternalServerError)
	}
}

// HandleOffboardingPreview godoc
//
// @Summary Preview item or place offboarding
// @Description Available to any authenticated member of the entity's collection. Confirmation covers the complete descendant tree.
// @Tags Entities
// @Produce json
// @Param id path string true "Entity ID"
// @Success 200 {object} repo.OffboardingPreview
// @Failure 404 {object} validate.ErrorResponse
// @Router /v1/entities/{id}/offboarding [GET]
// @Security Bearer
func (ctrl *V1Controller) HandleOffboardingPreview() errchain.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id, err := adapters.RouteUUID(r, "id")
		if err != nil {
			return err
		}
		out, err := ctrl.svc.Offboarding.Preview(services.NewContext(r.Context()), id)
		if err != nil {
			return offboardingError(err)
		}
		return server.JSON(w, http.StatusOK, out)
	}
}

// HandleOffboardingComplete godoc
//
// @Summary Offboard an item or place and all descendants
// @Description Any collection member may act. Requires a preview confirmation and a calendar date (YYYY-MM-DD). Sold, given_away and donated require a recipient. Notes may be empty; value may be omitted or zero. A changed tree returns 409 without mutation. Collection and recorder come from authentication, never the body.
// @Tags Entities
// @Accept json
// @Produce json
// @Param id path string true "Entity ID"
// @Param payload body services.OffboardingRequest true "Disposition and confirmed tree"
// @Success 200 {object} services.OffboardingResult
// @Failure 400 {object} validate.ErrorResponse
// @Failure 404 {object} validate.ErrorResponse
// @Failure 409 {object} validate.ErrorResponse
// @Router /v1/entities/{id}/offboarding [POST]
// @Security Bearer
func (ctrl *V1Controller) HandleOffboardingComplete() errchain.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id, err := adapters.RouteUUID(r, "id")
		if err != nil {
			return err
		}
		body, err := adapters.DecodeBody[services.OffboardingRequest](r)
		if err != nil {
			return validate.NewRequestError(err, http.StatusBadRequest)
		}
		out, err := ctrl.svc.Offboarding.CompleteRequest(services.NewContext(r.Context()), id, body)
		if err != nil {
			return offboardingError(err)
		}
		return server.JSON(w, http.StatusOK, out)
	}
}

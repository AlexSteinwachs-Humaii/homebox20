package v1

import (
	"net/http"

	"github.com/hay-kot/httpkit/errchain"
	"github.com/sysadminsmedia/homebox/backend/internal/core/services"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/internal/web/adapters"
)

// HandleCareGet godoc
//
// @Summary Query the group-scoped Care queue
// @Tags Care
// @Produce json
// @Success 200 {object} repo.CareQueue
// @Router /v1/care [GET]
// @Security Bearer
func (ctrl *V1Controller) HandleCareGet() errchain.HandlerFunc {
	return adapters.Query(func(r *http.Request, _ struct{}) (repo.CareQueue, error) {
		auth := services.NewContext(r.Context())
		return ctrl.repo.Care.Get(auth, auth.GID)
	}, http.StatusOK)
}

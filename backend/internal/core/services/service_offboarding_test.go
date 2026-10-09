package services

import (
	"math"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestOffboardingRequestValidation(t *testing.T) {
	valid := OffboardingRequest{Confirmation: strings.Repeat("a", 64), Disposition: "destroyed", Date: "2024-02-29"}
	for _, disposition := range []string{"sold", "destroyed", "given_away", "donated", "lost_or_stolen"} {
		r := valid
		r.Disposition = disposition
		r.Recipient = "recipient"
		require.NoError(t, r.Validate())
		r.Recipient = " \t"
		if disposition == "destroyed" || disposition == "lost_or_stolen" {
			require.NoError(t, r.Validate())
		} else {
			require.Error(t, r.Validate())
		}
	}
	for _, mutate := range []func(*OffboardingRequest){
		func(r *OffboardingRequest) { r.Disposition = "gift" },
		func(r *OffboardingRequest) { r.Disposition = "" },
		func(r *OffboardingRequest) { r.Date = "2025-02-29" },
		func(r *OffboardingRequest) { r.Date = "2026-10-09T00:00:00Z" },
		func(r *OffboardingRequest) { r.Date = "0000-01-01" },
		func(r *OffboardingRequest) { r.Date = "" },
		func(r *OffboardingRequest) { r.Confirmation = "" },
		func(r *OffboardingRequest) { r.Notes = strings.Repeat("a", 10001) },
		func(r *OffboardingRequest) { r.Recipient = strings.Repeat("a", 1001) },
	} {
		r := valid
		mutate(&r)
		require.Error(t, r.Validate())
	}
	for _, value := range []float64{-1, math.Inf(1), math.NaN()} {
		r := valid
		r.Value = &value
		require.Error(t, r.Validate())
	}
	for _, value := range []float64{0, 12.34} {
		r := valid
		r.Value = &value
		require.NoError(t, r.Validate())
	}
	require.NoError(t, valid.Validate()) // no value or notes required
}

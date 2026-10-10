package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
	"github.com/sysadminsmedia/homebox/backend/internal/data/repo"
	"github.com/sysadminsmedia/homebox/backend/pkgs/hasher"
)

func TestUserCreationPathsDefaultToClaude(t *testing.T) {
	ctx := context.Background()
	for _, path := range []string{"registration", "invitation", "oidc"} {
		t.Run(path, func(t *testing.T) {
			email := uuid.NewString() + "@example.test"
			var u repo.UserOut
			var err error
			if path == "oidc" {
				u, err = tSvc.User.registerOIDCUser(ctx, "https://issuer.example.test", uuid.NewString(), email, "OIDC user")
			} else {
				input := UserRegistration{Name: path, Email: email, Password: "correct-horse-battery-staple"}
				if path == "invitation" {
					token := hasher.GenerateToken()
					_, err := tRepos.Groups.InvitationCreate(ctx, tGroup.ID, repo.GroupInvitationCreate{Token: token.Hash, Uses: 1, ExpiresAt: time.Now().Add(time.Hour)})
					require.NoError(t, err)
					input.GroupToken = token.Raw
				}
				u, err = tSvc.User.RegisterUser(ctx, input)
			}
			require.NoError(t, err)
			saved, err := tClient.User.Get(ctx, u.ID)
			require.NoError(t, err)
			require.Equal(t, map[string]interface{}{"theme": "claude"}, saved.Settings)
			if path == "invitation" {
				require.Equal(t, tGroup.ID, u.DefaultGroupID)
			}
		})
	}
}

package repo

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUserSettingsThemeFallback(t *testing.T) {
	ctx := context.Background()
	u, err := tRepos.Users.Create(ctx, userFactory())
	require.NoError(t, err)
	defer func() { require.NoError(t, tRepos.Users.Delete(ctx, u.ID)) }()
	for _, settings := range []map[string]interface{}{
		nil, {}, {"theme": nil}, {"theme": "", "language": "de"}, {"language": "fr"}, {"theme": "dark", "language": "en"},
	} {
		require.NoError(t, tRepos.Users.SetSettings(ctx, u.ID, settings))
		got, err := tRepos.Users.GetSettings(ctx, u.ID)
		require.NoError(t, err)
		expected := map[string]interface{}{"theme": "claude"}
		for k, v := range settings {
			if k != "theme" || (v != nil && v != "") {
				expected[k] = v
			}
		}
		require.Equal(t, expected, got)
		// Reading defaults must not mutate saved preferences or trigger a rollout.
		saved, err := tClient.User.Get(ctx, u.ID)
		require.NoError(t, err)
		require.Equal(t, settings, saved.Settings)
	}
}

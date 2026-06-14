import { Redirect } from 'expo-router';

/**
 * Root index route for the personal-color-kr Expo app shell.
 *
 * The app has no standalone landing screen — the 12-step funnel IS the entry
 * experience — so `/` redirects into the funnel at its first step
 * (`welcome-hook`). The funnel's own `(funnel)/_layout` owns the
 * resume-at-step logic; this route just hands off to it.
 *
 * (Replaces the Phase-2 placeholder, whose "Enter funnel" link pointed at a
 * non-existent `/step-1` route and rendered an Unmatched Route screen.)
 */
export default function Index(): JSX.Element {
  return <Redirect href="/(funnel)/welcome-hook" />;
}

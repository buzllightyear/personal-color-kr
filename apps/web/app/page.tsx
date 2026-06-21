/**
 * Landing page — served at the root of apps/web.
 *
 * The static landing page content lives in public/index.html.
 * This route simply redirects browsers hitting the Next.js root
 * to the static file, while the /admin route tree handles recipe management.
 *
 * In production the static site (apps/web/index.html) is served separately;
 * this redirect exists for local dev convenience.
 */
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/admin');
}

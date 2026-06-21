/**
 * Stub for next/navigation in vitest tests.
 *
 * Provides mock implementations of useRouter, usePathname, and
 * useSearchParams so component tests can assert on navigation calls
 * without the Next.js runtime being present.
 */
import { vi } from 'vitest';

export const mockPush = vi.fn();
export const mockReplace = vi.fn();
export const mockBack = vi.fn();
export const mockRefresh = vi.fn();

export function useRouter() {
  return {
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    refresh: mockRefresh,
    prefetch: vi.fn(),
    forward: vi.fn(),
  };
}

export function usePathname(): string {
  return '/admin';
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function redirect(url: string): never {
  throw new Error(`redirect called with: ${url}`);
}

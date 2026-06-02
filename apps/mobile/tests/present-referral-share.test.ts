/**
 * Unit test — `present-referral-share.ts` (Phase 4.5).
 *
 * Pins that the presenter hands the *server* `share_url` to React Native's
 * built-in `Share.share` (the OS share sheet — NOT the deferred Kakao SDK),
 * for both share methods.
 */
import { describe, expect, it, vi } from 'vitest';

// `vi.mock` is hoisted above all imports, so the spy it references must be
// created via `vi.hoisted` (also hoisted) rather than a plain top-level const.
const { shareSpy } = vi.hoisted(() => ({
  shareSpy: vi.fn(() => Promise.resolve({ action: 'sharedAction' })),
}));

vi.mock('react-native', () => ({
  Share: {
    share: shareSpy,
  },
}));

import { presentReferralShare } from '../src/present-referral-share';

describe('presentReferralShare', () => {
  it('passes the server share_url as the share-sheet message for kakao', async () => {
    shareSpy.mockClear();
    await presentReferralShare('kakao', 'https://pcolor.example/r/abc12345');
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'https://pcolor.example/r/abc12345',
    });
  });

  it('passes the server share_url as the share-sheet message for copy_link', async () => {
    shareSpy.mockClear();
    await presentReferralShare('copy_link', 'https://pcolor.example/r/zzz99999');
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'https://pcolor.example/r/zzz99999',
    });
  });
});

/**
 * Unit test — `share-referral-link.ts` (Phase 4.5).
 *
 * Pins the share-handler orchestration contract:
 *   - fetches the server `share_url` and presents IT (not a client-assembled
 *     URL) for the tapped method;
 *   - degrades silently on a transport OR presenter failure (the referral gate
 *     is a soft gate — it must never throw into funnel navigation).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  shareReferralLink,
  type ReferralSharePresenter,
} from '../src/share-referral-link';
import type { ReferralMeWireResponse } from '../src/fetch-referral-me';

const WIRE: ReferralMeWireResponse = {
  referral_code: 'abc12345',
  share_url: 'https://pcolor.example/r/abc12345',
  friend_used_count: 0,
};

describe('shareReferralLink — happy path', () => {
  it('presents the server share_url for the tapped method', async () => {
    const present = vi.fn<Parameters<ReferralSharePresenter>, void>();
    const result = await shareReferralLink('kakao', {
      transport: () => Promise.resolve(WIRE),
      present,
    });

    expect(present).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledWith('kakao', 'https://pcolor.example/r/abc12345');
    expect(result).toEqual({
      shared: true,
      shareUrl: 'https://pcolor.example/r/abc12345',
    });
  });

  it('forwards the copy_link method through to the presenter', async () => {
    const present = vi.fn<Parameters<ReferralSharePresenter>, void>();
    await shareReferralLink('copy_link', {
      transport: () => Promise.resolve(WIRE),
      present,
    });
    expect(present).toHaveBeenCalledWith(
      'copy_link',
      'https://pcolor.example/r/abc12345',
    );
  });
});

describe('shareReferralLink — silent degradation (soft gate)', () => {
  it('returns { shared: false } and never throws when the fetch fails', async () => {
    const present = vi.fn<Parameters<ReferralSharePresenter>, void>();
    const result = await shareReferralLink('kakao', {
      transport: () => Promise.reject(new Error('401')),
      present,
    });
    expect(result).toEqual({ shared: false, shareUrl: null });
    expect(present).not.toHaveBeenCalled();
  });

  it('returns { shared: false } and never throws when the presenter fails', async () => {
    const present: ReferralSharePresenter = () =>
      Promise.reject(new Error('share sheet dismissed with error'));
    const result = await shareReferralLink('copy_link', {
      transport: () => Promise.resolve(WIRE),
      present,
    });
    expect(result).toEqual({ shared: false, shareUrl: null });
  });
});

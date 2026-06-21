import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: '퍼스널 컬러',
  description: '1분 셀카 진단 — 퍼스널 컬러 진단',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

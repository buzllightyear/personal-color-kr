/**
 * Admin section layout.
 *
 * Wraps all /admin routes with:
 * 1. AdminAuthGuard — credential prompt for operators without a stored token.
 * 2. A minimal navigation bar linking to the recipe list.
 *
 * The AdminAuthGuard component is 'use client' (reads localStorage), which
 * means this layout is also a client subtree.  The individual page components
 * may be server components if they don't depend on the guard's context.
 */

import React from 'react';
import AdminAuthGuard from '@/components/admin/AdminAuthGuard';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Admin — 퍼스널 컬러',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthGuard>
      <div style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        <nav
          style={{
            borderBottom: '1px solid #e5e7eb',
            padding: '0.75rem 1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            background: '#fff',
          }}
        >
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>퍼스널 컬러 Admin</span>
          <a
            href="/admin"
            style={{ fontSize: '0.875rem', color: '#374151', textDecoration: 'none' }}
          >
            Recipes
          </a>
        </nav>
        <main style={{ padding: '2rem 1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
          {children}
        </main>
      </div>
    </AdminAuthGuard>
  );
}

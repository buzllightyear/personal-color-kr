/**
 * Stub for next/link in vitest tests.
 * Renders a plain <a> element so tests can assert on href/children.
 */
import React from 'react';

interface LinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  [key: string]: unknown;
}

export default function Link({ href, children, className }: LinkProps) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

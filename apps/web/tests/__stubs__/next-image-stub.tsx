/**
 * Stub for next/image in vitest tests.
 * Renders a plain <img> element so tests can assert on src/alt attributes.
 */
import React from 'react';

interface ImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  [key: string]: unknown;
}

export default function Image({
  src,
  alt,
  width,
  height,
  className,
  style,
}: ImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
    />
  );
}

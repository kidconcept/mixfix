'use client';

import { useState } from 'react';

/**
 * One-line message component with expandable read more/show less toggle (portrait only).
 * Displays single line by default in portrait with option to expand for full content.
 * Shows full content without truncation on desktop/landscape.
 */

interface MessageProps {
  children: React.ReactNode;
  type?: 'info' | 'error' | 'loading';
  className?: string;
}

export default function Message({ children, type = 'info', className = '' }: MessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`text-left text-sm ${className}`} style={{ color: 'var(--text-primary)' }}>
      <div className={isExpanded ? '' : 'message-container'}>
        <span className={isExpanded ? '' : 'message-content'}>
          {children}
        </span>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="message-toggle underline whitespace-nowrap"
          style={{ color: 'var(--interactive-primary)' }}
        >
          {isExpanded ? 'Show less' : 'Read more'}
        </button>
      </div>
    </div>
  );
}

/**
 * Simple one-line message component for displaying concise status information.
 * Messages should be brief and to the point - avoid verbose explanations.
 */

interface MessageProps {
  children: React.ReactNode;
  type?: 'info' | 'error' | 'loading';
  className?: string;
}

export default function Message({ children, type = 'info', className = '' }: MessageProps) {
  const color = type === 'error' ? 'var(--alert)' : 'var(--text-secondary)';
  
  return (
    <div className={`text-left text-sm ${className}`} style={{ color }}>
      {children}
    </div>
  );
}

import clsx from 'clsx';

type Accent = 'blue' | 'green' | 'red' | 'neutral';

interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  icon?: string;
  accent?: Accent;
  positive?: boolean;
  negative?: boolean;
}

const ACCENT_BORDER: Record<Accent, string> = {
  blue: 'border-l-[var(--accent-blue)]',
  green: 'border-l-[var(--accent-green)]',
  red: 'border-l-[var(--accent-red)]',
  neutral: 'border-l-[var(--border)]',
};

export function StatCard({ title, value, subtext, icon, accent = 'neutral', positive, negative }: StatCardProps) {
  return (
    <div className={clsx('card border-l-4', ACCENT_BORDER[accent])}>
      <p className="stat-label flex items-center gap-1.5">
        {icon && <span className="text-sm">{icon}</span>}
        {title}
      </p>
      <p
        className={clsx(
          'stat-value mt-2',
          positive && 'text-green-400',
          negative && 'text-red-400',
          !positive && !negative && 'text-[var(--text-primary)]',
        )}
      >
        {value}
      </p>
      {subtext && <p className="mt-1 text-xs text-[var(--text-secondary)]">{subtext}</p>}
    </div>
  );
}

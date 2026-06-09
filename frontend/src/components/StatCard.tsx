import clsx from 'clsx';

interface StatCardProps {
  title: string;
  value: string | number;
  subtext?: string;
  positive?: boolean;
  negative?: boolean;
}

export function StatCard({ title, value, subtext, positive, negative }: StatCardProps) {
  return (
    <div className="card">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</p>
      <p
        className={clsx(
          'mt-2 text-2xl font-bold',
          positive && 'text-green-400',
          negative && 'text-red-400',
          !positive && !negative && 'text-white',
        )}
      >
        {value}
      </p>
      {subtext && <p className="mt-1 text-xs text-gray-500">{subtext}</p>}
    </div>
  );
}

'use client';

import { ReactNode } from 'react';
import clsx from 'clsx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  // Cell renderer for desktop table mode.
  cell: (row: T) => ReactNode;
  // Mobile card label. If omitted, falls back to `header`. Pass `null` to hide on mobile.
  mobileLabel?: ReactNode | null;
  // Mobile card cell renderer. Defaults to `cell`.
  mobileCell?: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right';
  // Show this column as the prominent card title on mobile.
  mobilePrimary?: boolean;
  // Hide this column on mobile entirely (e.g. action buttons rendered separately).
  hideOnMobile?: boolean;
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: ReactNode;
  // Optional renderer for the bottom-right area of each mobile card (e.g. action buttons).
  mobileActions?: (row: T) => ReactNode;
}

export function ResponsiveTable<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  emptyMessage = 'Aucun résultat.',
  mobileActions,
}: Props<T>) {
  if (data.length === 0) {
    return (
      <div className="card p-8 text-center text-slate-500 text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden md:block card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={clsx(
                    'px-4 py-3 font-medium text-slate-700',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.className,
                  )}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {data.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(
                  'hover:bg-slate-50',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={clsx(
                      'px-4 py-3',
                      col.align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    {col.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {data.map((row) => {
          const primary = columns.find((c) => c.mobilePrimary);
          const rest = columns.filter((c) => !c.mobilePrimary && !c.hideOnMobile);
          return (
            <div
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={clsx(
                'card p-4 space-y-2',
                onRowClick && 'cursor-pointer active:bg-slate-50',
              )}
            >
              {primary && (
                <div className="text-base font-semibold text-slate-900">
                  {(primary.mobileCell ?? primary.cell)(row)}
                </div>
              )}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                {rest.map((col) => {
                  const label = col.mobileLabel ?? col.header;
                  if (label === null) return null;
                  return (
                    <div key={col.key} className="contents">
                      <dt className="text-xs text-slate-500 self-center">{label}</dt>
                      <dd className="text-slate-800 min-w-0 break-words">
                        {(col.mobileCell ?? col.cell)(row)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {mobileActions && (
                <div className="pt-2 border-t border-slate-100 flex justify-end gap-2">
                  {mobileActions(row)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

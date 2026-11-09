import * as React from "react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, LoadingState, ErrorState } from "@/components/states";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render: (row: T) => React.ReactNode;
  sortableValue?: (row: T) => string | number;
}

/**
 * DataTable — generic presentational table (register-slide styling).
 * Server components pass data; no client fetching inside (brief section 55:
 * domain boundaries — data access never happens in components).
 */
export function DataTable<T>({
  columns,
  rows,
  caption,
  loading,
  error,
  errorDetail,
  emptyTitle,
  emptyHint,
  className,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  caption?: string;
  loading?: boolean;
  error?: string | null;
  errorDetail?: string;
  emptyTitle?: string;
  emptyHint?: string;
  className?: string;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (error) return <ErrorState detail={errorDetail ?? error} className={className} />;
  if (loading) return <LoadingState label={`Loading ${caption ?? "data"}…`} className={className} />;
  if (!rows || rows.length === 0)
    return <EmptyState title={emptyTitle ?? "No records yet"} hint={emptyHint} className={className} />;

  return (
    <div className={className}>
      <Table>
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <THead>
          <TR>
            {columns.map((c) => (
              <TH key={c.key} scope="col" className={c.className}>
                {c.header}
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {rows.map((row, i) => (
            <TR key={i} className={rowClassName?.(row)}>
              {columns.map((c) => (
                <TD key={c.key} className={c.className}>
                  {c.render(row)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

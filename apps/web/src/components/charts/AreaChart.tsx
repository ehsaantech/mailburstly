import { useId } from "react";
import { cn } from "@/lib/cn";

export interface SeriesPoint {
  date: string;
  [key: string]: string | number;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  fill?: boolean;
  /**
   * Which scale the series is drawn against. Use "right" when a series has a
   * very different magnitude from the primary one (e.g. replies vs sends) so
   * it does not flatten into a straight line.
   */
  axis?: "left" | "right";
}

/**
 * Dependency-free area/line chart.
 *
 * Deliberately hand-rolled: pulling in Recharts for two charts would add
 * ~90KB to the bundle for no benefit at this scale.
 */
export function AreaChart({
  data,
  series,
  height = 220,
  className,
  showGrid = true,
  formatValue,
}: {
  data: SeriesPoint[];
  series: Series[];
  height?: number;
  className?: string;
  showGrid?: boolean;
  formatValue?: (value: number) => string;
}) {
  const gradientId = useId().replace(/:/g, "");
  const width = 800;
  const padX = 8;
  const padY = 12;

  if (data.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-fg-subtle", className)}
        style={{ height }}
      >
        No data for this period
      </div>
    );
  }

  const axisMax = (axis: "left" | "right") => {
    const values = data.flatMap((d) =>
      series
        .filter((s) => (s.axis ?? "left") === axis)
        .map((s) => Number(d[s.key] ?? 0)),
    );
    return Math.max(1, ...values);
  };

  const leftMax = axisMax("left");
  const rightMax = axisMax("right");
  const usesRight = series.some((s) => s.axis === "right");

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const x = (i: number) =>
    padX + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);

  const y = (value: number, axis: "left" | "right") => {
    const max = axis === "right" ? rightMax : leftMax;
    return padY + innerH - (value / max) * innerH;
  };

  const linePath = (s: Series) =>
    data
      .map((d, i) => {
        const axis = s.axis ?? "left";
        return `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(Number(d[s.key] ?? 0), axis).toFixed(2)}`;
      })
      .join(" ");

  const areaPath = (s: Series) => {
    const line = linePath(s);
    const baseline = (padY + innerH).toFixed(2);
    return `${line} L${x(data.length - 1).toFixed(2)},${baseline} L${x(0).toFixed(2)},${baseline} Z`;
  };

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Trend chart"
      >
        <defs>
          {series.map((s) => (
            <linearGradient
              key={s.key}
              id={`${gradientId}-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>

        {showGrid
          ? gridLines.map((g) => (
              <line
                key={g}
                x1={padX}
                x2={width - padX}
                y1={padY + innerH * g}
                y2={padY + innerH * g}
                stroke="var(--border)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))
          : null}

        {series.map((s) =>
          s.fill ? (
            <path
              key={`fill-${s.key}`}
              d={areaPath(s)}
              fill={`url(#${gradientId}-${s.key})`}
            />
          ) : null,
        )}

        {series.map((s) => (
          <path
            key={`line-${s.key}`}
            d={linePath(s)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
        {series.map((s) => {
          const total = data.reduce((sum, d) => sum + Number(d[s.key] ?? 0), 0);
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-[11px] text-fg-muted">{s.label}</span>
              <span className="tabular text-[11px] font-semibold text-fg">
                {formatValue ? formatValue(total) : total.toLocaleString()}
              </span>
            </div>
          );
        })}
        {usesRight ? (
          <span className="text-[10px] text-fg-subtle">
            right-hand series use their own scale
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-fg-subtle">
          {data[0]?.date} → {data[data.length - 1]?.date}
        </span>
      </div>
    </div>
  );
}

/** Tiny inline sparkline for table rows. */
export function Sparkline({
  values,
  color = "var(--accent)",
  className,
}: {
  values: number[];
  color?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const width = 72;
  const height = 20;
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const range = Math.max(1, max - min);

  const path = values
    .map((v, i) => {
      const px = (i / (values.length - 1)) * width;
      const py = height - ((v - min) / range) * (height - 2) - 1;
      return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("h-5 w-[72px]", className)}
      aria-hidden
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

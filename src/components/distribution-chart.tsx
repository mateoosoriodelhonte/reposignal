import { type Bucket, describeDistribution, worthCharting } from '@/lib/charts/histogram';

/**
 * A distribution as server-rendered SVG.
 *
 * No charting library and no client JavaScript: these are static bars, and
 * shipping a runtime to draw seven rectangles would be a poor trade.
 *
 * Accessibility is structural rather than bolted on. The SVG is `aria-hidden`
 * and the same numbers are rendered as a real `<table>`, visually hidden by
 * default and available to every assistive technology. Because both are built
 * from the same `buckets` array, the text alternative cannot drift from the
 * picture — the usual failure mode of hand-written chart descriptions.
 */

const BAR_HEIGHT = 28;
const BAR_GAP = 6;
const LABEL_WIDTH = 128;
/** Wide enough for a four-digit commit count without clipping. */
const VALUE_WIDTH = 52;
const CHART_WIDTH = 520;
/** Room under the plot for the max-value tick label. */
const AXIS_HEIGHT = 16;
/** Fractions of the maximum to draw a gridline at. */
const GRID_FRACTIONS = [0.25, 0.5, 0.75, 1];

export function DistributionChart({
  buckets,
  title,
  noun,
  description,
}: {
  buckets: Bucket[];
  title: string;
  /** Plural noun for the text alternative, e.g. "open issues". */
  noun: string;
  description?: string;
}) {
  // Rendering an empty frame would imply "we looked and found nothing to say",
  // when the truth is there was not enough to chart.
  if (!worthCharting(buckets)) return null;

  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  const plotWidth = CHART_WIDTH - LABEL_WIDTH - VALUE_WIDTH;
  const plotHeight = buckets.length * (BAR_HEIGHT + BAR_GAP);
  const height = plotHeight + AXIS_HEIGHT;
  const summary = describeDistribution(buckets, noun);

  return (
    <figure className="m-0">
      <figcaption className="text-sm font-medium">{title}</figcaption>
      {description !== undefined && (
        <p className="text-muted mt-1 text-xs">{description}</p>
      )}

      <div className="mt-3 overflow-x-auto">
        {/*
          Rendered at its natural size and allowed to shrink, never stretched.
          A fixed height with `width="100%"` letterboxes the viewBox: the
          content is scaled to fit the height and centred, which pushes the
          labels into the middle of the chart.
        */}
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${height}`}
          width={CHART_WIDTH}
          height={height}
          role="img"
          aria-label={summary}
          className="h-auto max-w-full"
        >
          {/*
            Scale reference, drawn first so the bars sit on top of it. Without
            it a reader can compare bars to each other but has no sense of
            whether the longest one is 12 or 1,200.

            Only the maximum is labelled. Labelling every gridline would mean
            inventing "nice" round numbers, and at a small maximum the quarter
            marks are fractional counts — 0.5 of an issue is worse than no
            label at all. One absolute anchor plus evenly spaced marks is
            enough to read the scale off.
          */}
          <g aria-hidden="true">
            {GRID_FRACTIONS.map((fraction) => (
              <line
                key={fraction}
                x1={LABEL_WIDTH + fraction * plotWidth}
                x2={LABEL_WIDTH + fraction * plotWidth}
                y1={0}
                y2={plotHeight}
                strokeWidth={1}
                className="stroke-border-subtle"
              />
            ))}

            <text
              x={LABEL_WIDTH + plotWidth}
              y={plotHeight + AXIS_HEIGHT - 5}
              textAnchor="end"
              className="fill-muted text-[10px] tabular-nums"
            >
              {max}
            </text>
          </g>

          {buckets.map((bucket, index) => {
            const y = index * (BAR_HEIGHT + BAR_GAP);
            const width = bucket.count === 0 ? 0 : (bucket.count / max) * plotWidth;

            return (
              <g key={bucket.label}>
                <text
                  x={0}
                  y={y + BAR_HEIGHT / 2}
                  dominantBaseline="middle"
                  className="fill-muted text-[11px]"
                >
                  {bucket.label}
                </text>

                {/* Track, so an empty bucket still reads as a row. */}
                <rect
                  x={LABEL_WIDTH}
                  y={y + 6}
                  width={plotWidth}
                  height={BAR_HEIGHT - 12}
                  rx={3}
                  className="fill-surface"
                />

                {width > 0 && (
                  <rect
                    x={LABEL_WIDTH}
                    y={y + 6}
                    width={width}
                    height={BAR_HEIGHT - 12}
                    rx={3}
                    className="fill-accent"
                  />
                )}

                <text
                  x={LABEL_WIDTH + plotWidth + 8}
                  y={y + BAR_HEIGHT / 2}
                  dominantBaseline="middle"
                  className="fill-foreground text-[11px] tabular-nums"
                >
                  {bucket.count}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        The same data, as a table, for assistive technology.

        `sr-only` goes on a wrapping div, not on the table itself: table layout
        ignores the `width: 1px` that `sr-only` relies on and expands to fit its
        content, which made this "hidden" table 2192px wide and gave the whole
        document a horizontal scrollbar.
      */}
      <div className="sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Age</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.label}>
                <th scope="row">{bucket.label}</th>
                <td>{bucket.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

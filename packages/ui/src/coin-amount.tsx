import { cn } from "@liverush/lib";

/**
 * Virtual rush-coin currency primitives, shared across user-app /
 * studio / admin-app.
 *
 * The platform's soft currency is coins, not dollars. Anywhere a
 * `$` sign used to live next to a numeric amount, render a
 * `<CoinAmount>` (or a bare `<CoinIcon />` when the surrounding
 * markup already supplies the number) so the user sees the coin
 * glyph instead.
 *
 * The SVG is inlined as a base64 data URI so the package can be
 * imported by any app without a bundler-specific asset import.
 * Same icon ships in every consumer.
 *
 * Three exports:
 *   • <CoinIcon />        — the SVG only, sized to 1em so it tracks
 *                           the surrounding text line-height.
 *   • <CoinAmount cents={n} /> — icon + formatted number, joined by
 *                           a tabular-nums span with `leading-none`
 *                           + `items-center` for clean vertical
 *                           alignment at any text size.
 *   • formatCoins(cents)  — string formatter for non-JSX paths
 *                           (toast messages, aria labels, button
 *                           text). Returns just the number — no
 *                           currency symbol — so callers can
 *                           prepend whatever copy they like.
 */

const COIN_ICON_URL =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI0MCIgY3k9IjQwIiByPSIzOS41IiBmaWxsPSIjRkZEQzJBIiBzdHJva2U9IiNFMUEwMDQiLz48ZyBmaWx0ZXI9InVybCgjZmlsdGVyMF9pXzIwNF8yMikiPjxjaXJjbGUgY3g9IjQwIiBjeT0iNDAiIHI9IjMxIiBmaWxsPSIjRkZCNjA5Ii8+PC9nPjxnIGZpbHRlcj0idXJsKCNmaWx0ZXIxX2RfMjA0XzIyKSI+PHBhdGggZD0iTTM2LjM2MzggNDMuMTk2MkgyNi42Nzc0QzI1LjkyIDQzLjE5NjIgMjUuNDM3NSA0Mi4zODY5IDI1Ljc5NzcgNDEuNzIwN0wzNi43MTY1IDIxLjUyNDRDMzYuODkxMiAyMS4yMDEzIDM3LjIyODkgMjEgMzcuNTk2MiAyMUg0Ny44Mjg1QzQ4LjU5NDkgMjEgNDkuMDc2NSAyMS44MjY4IDQ4LjY5ODMgMjIuNDkzNEw0Mi4wNjcxIDM0LjE4MzRDNDEuNjg4OSAzNC44NTAxIDQyLjE3MDUgMzUuNjc2OCA0Mi45MzY5IDM1LjY3NjhINTIuNjg5NkM1My41NjU0IDM1LjY3NjggNTQuMDE4MSAzNi43MjI4IDUzLjQxODcgMzcuMzYxM0wzMi41ODQzIDU5LjU1MzlDMzEuODA5MiA2MC4zNzk2IDMwLjQ3NDkgNTkuNDgzNyAzMC45NDU4IDU4LjQ1MzdMMzcuMjczMyA0NC42MTJDMzcuNTc2MSA0My45NDk3IDM3LjA5MjEgNDMuMTk2MiAzNi4zNjM4IDQzLjE5NjJaIiBmaWxsPSJ3aGl0ZSIvPjxwYXRoIGQ9Ik0zNi4zNjM4IDQzLjE5NjJIMjYuNjc3NEMyNS45MiA0My4xOTYyIDI1LjQzNzUgNDIuMzg2OSAyNS43OTc3IDQxLjcyMDdMMzYuNzE2NSAyMS41MjQ0QzM2Ljg5MTIgMjEuMjAxMyAzNy4yMjg5IDIxIDM3LjU5NjIgMjFINDcuODI4NUM0OC41OTQ5IDIxIDQ5LjA3NjUgMjEuODI2OCA0OC42OTgzIDIyLjQ5MzRMNDIuMDY3MSAzNC4xODM0QzQxLjY4ODkgMzQuODUwMSA0Mi4xNzA1IDM1LjY3NjggNDIuOTM2OSAzNS42NzY4SDUyLjY4OTZDNTMuNTY1NCAzNS42NzY4IDU0LjAxODEgMzYuNzIyOCA1My40MTg3IDM3LjM2MTNMMzIuNTg0MyA1OS41NTM5QzMxLjgwOTIgNjAuMzc5NiAzMC40NzQ5IDU5LjQ4MzcgMzAuOTQ1OCA1OC40NTM3TDM3LjI3MzMgNDQuNjEyQzM3LjU3NjEgNDMuOTQ5NyAzNy4wOTIxIDQzLjE5NjIgMzYuMzYzOCA0My4xOTYyWiIgc3Ryb2tlPSIjRUJBMjA0IiBzdHJva2Utd2lkdGg9IjIiLz48L2c+PGRlZnM+PGZpbHRlciBpZD0iZmlsdGVyMF9pXzIwNF8yMiIgeD0iOSIgeT0iOSIgd2lkdGg9IjYyIiBoZWlnaHQ9IjYyIiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz48ZmVCbGVuZCBtb2RlPSJub3JtYWwiIGluPSJTb3VyY2VHcmFwaGljIiBpbjI9IkJhY2tncm91bmRJbWFnZUZpeCIgcmVzdWx0PSJzaGFwZSIvPjxmZUNvbG9yTWF0cml4IGluPSJTb3VyY2VBbHBoYSIgdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDEyNyAwIiByZXN1bHQ9ImhhcmRBbHBoYSIvPjxmZU9mZnNldCBkeT0iNCIvPjxmZUNvbXBvc2l0ZSBpbjI9ImhhcmRBbHBoYSIgb3BlcmF0b3I9ImFyaXRobWV0aWMiIGsyPSItMSIgazM9IjEiLz48ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwLjg4MzMwMSAwIDAgMCAwIDAuNjI2MjI5IDAgMCAwIDAgMC4wMTcwMDMxIDAgMCAwIDEgMCIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJzaGFwZSIgcmVzdWx0PSJlZmZlY3QxX2lubmVyU2hhZG93XzIwNF8yMiIvPjwvZmlsdGVyPjxmaWx0ZXIgaWQ9ImZpbHRlcjFfZF8yMDRfMjIiIHg9IjI0LjY3NDYiIHk9IjIwIiB3aWR0aD0iMzAuMDE4OSIgaGVpZ2h0PSI0Mi44ODU2IiBmaWx0ZXJVbml0cz0idXNlclNwYWNlT25Vc2UiIGNvbG9yLWludGVycG9sYXRpb24tZmlsdGVycz0ic1JHQiI+PGZlRmxvb2QgZmxvb2Qtb3BhY2l0eT0iMCIgcmVzdWx0PSJCYWNrZ3JvdW5kSW1hZ2VGaXgiLz48ZmVDb2xvck1hdHJpeCBpbj0iU291cmNlQWxwaGEiIHR5cGU9Im1hdHJpeCIgdmFsdWVzPSIwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAwIDAgMCAxMjcgMCIgcmVzdWx0PSJoYXJkQWxwaGEiLz48ZmVPZmZzZXQgZHk9IjIiLz48ZmVDb21wb3NpdGUgaW4yPSJoYXJkQWxwaGEiIG9wZXJhdG9yPSJvdXQiLz48ZmVDb2xvck1hdHJpeCB0eXBlPSJtYXRyaXgiIHZhbHVlcz0iMCAwIDAgMCAwLjkyMTU2OSAwIDAgMCAwIDAuNjM1Mjk0IDAgMCAwIDAgMC4wMTU2ODYzIDAgMCAwIDEgMCIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW4yPSJCYWNrZ3JvdW5kSW1hZ2VGaXgiIHJlc3VsdD0iZWZmZWN0MV9kcm9wU2hhZG93XzIwNF8yMiIvPjxmZUJsZW5kIG1vZGU9Im5vcm1hbCIgaW49IlNvdXJjZUdyYXBoaWMiIGluMj0iZWZmZWN0MV9kcm9wU2hhZG93XzIwNF8yMiIgcmVzdWx0PSJzaGFwZSIvPjwvZmlsdGVyPjwvZGVmcz48L3N2Zz4=";

export interface CoinIconProps {
  className?: string;
}

export function CoinIcon({ className }: CoinIconProps) {
  return (
    <img
      src={COIN_ICON_URL}
      alt=""
      aria-hidden
      // 1em square so the icon scales with the surrounding font.
      // `block` reset prevents the default `inline` baseline shift
      // some browsers apply to `<img>`; callers wrap us in an
      // `inline-flex items-center leading-none` parent so the
      // icon's visual centre lines up with the digit's visual
      // centre at every text size.
      className={cn(
        "block h-[1em] w-[1em] flex-shrink-0",
        className,
      )}
    />
  );
}

export interface CoinAmountProps {
  /** Amount in cents — divided by 100 for display. Use either
   *  `cents` or `value`, not both. */
  cents?: number;
  /** Amount already in whole-currency units. */
  value?: number;
  /** Number of fraction digits. Default 2. Pass 0 for round
   *  numbers in dense layouts (e.g. "Min 30" instead of "Min
   *  30.00"). */
  fractionDigits?: number;
  className?: string;
  /** Sizing override for the icon. Default matches surrounding
   *  text. */
  iconClassName?: string;
}

export function CoinAmount({
  cents,
  value,
  fractionDigits = 2,
  className,
  iconClassName,
}: CoinAmountProps) {
  const v =
    cents !== undefined ? cents / 100 : value !== undefined ? value : 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 leading-none tabular-nums",
        className,
      )}
    >
      <CoinIcon className={iconClassName} />
      <span>{v.toFixed(fractionDigits)}</span>
    </span>
  );
}

/** Plain-text version for toast / aria-label / non-JSX contexts.
 *  Returns the bare number — no symbol — so callers can choose
 *  whether to prepend "🪙" / "coins" / nothing. */
export function formatCoins(cents: number, fractionDigits = 2): string {
  return (cents / 100).toFixed(fractionDigits);
}

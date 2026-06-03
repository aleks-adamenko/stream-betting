import coinIconUrl from "@/assets/icons/rc-icon.svg";
import { cn } from "@/lib/utils";

/**
 * Virtual-coin currency primitives.
 *
 * The user-app treats balances as a soft / virtual currency, not
 * real USD. Anywhere a `$` sign used to live next to a numeric
 * amount, render a `<CoinAmount>` (or a bare `<CoinIcon />` if the
 * surrounding markup already supplies the number) so the user sees
 * the rush-coin glyph instead.
 *
 * Three exports:
 *   • <CoinIcon />         — the SVG only. Sized to 1em so it
 *                            naturally tracks the surrounding text
 *                            line-height. Pass `className` for
 *                            explicit sizing.
 *   • <CoinAmount cents />  — icon + formatted number, joined by a
 *                            tabular-nums span. Either `cents` or
 *                            `value` (whole units) can be supplied.
 *   • formatCoins(cents)    — string formatter for non-JSX paths
 *                            (toast messages, aria labels). Returns
 *                            just the number string — no symbol —
 *                            so callers can choose whether to
 *                            append "RC" / "coins" or leave it bare.
 */

interface CoinIconProps {
  className?: string;
}

export function CoinIcon({ className }: CoinIconProps) {
  return (
    <img
      src={coinIconUrl}
      alt=""
      aria-hidden
      // 1em square so the coin scales with the surrounding text.
      // No `vertical-align` override here — callers should wrap the
      // icon in an `inline-flex items-center leading-none` parent
      // (CoinAmount does this for you) so the icon's visual centre
      // lines up with the digit's visual centre. The extra
      // `block` reset prevents the default `inline` baseline shift
      // some browsers apply to `<img>`.
      className={cn(
        "block h-[1em] w-[1em] flex-shrink-0",
        className,
      )}
    />
  );
}

interface CoinAmountProps {
  /** Amount in cents — divided by 100 for display. Use either
   *  `cents` or `value`, not both. */
  cents?: number;
  /** Amount already in whole-currency units. */
  value?: number;
  /** Number of fraction digits. Default 2. Pass 0 for round numbers
   *  in dense layouts (e.g. "Min 30" instead of "Min 30.00"). */
  fractionDigits?: number;
  className?: string;
  /** Sizing override for the icon. Default matches surrounding text. */
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
    // `leading-none` collapses the text's line-height to its
    // font-size so the digit's bounding box matches the icon's. With
    // `items-center` the visual centres then line up cleanly at any
    // text size (small balance chip / huge balance hero / inline
    // stake chip — same alignment formula).
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
 *  Returns a number string with NO currency symbol — callers can
 *  prepend "RC" / "coins" suffix or leave it bare. */
export function formatCoins(cents: number, fractionDigits = 2): string {
  return (cents / 100).toFixed(fractionDigits);
}

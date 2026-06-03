// Re-export from the shared `@liverush/ui` package so studio +
// admin-app + user-app all draw the same coin primitives. This
// shim exists only to keep the existing user-app import paths
// (`@/components/ui/CoinAmount`) working without rewriting every
// callsite — new code should import directly from `@liverush/ui`.
export {
  CoinAmount,
  CoinIcon,
  formatCoins,
  type CoinAmountProps,
  type CoinIconProps,
} from "@liverush/ui";

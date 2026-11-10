// React's CSSProperties has no room for custom properties. This gives style={{ "--bar-h": "58px" }} a type.
import "react";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

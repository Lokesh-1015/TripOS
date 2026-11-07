import { createContext } from "react";

/** Set by a form Field so its input can say it's invalid and point at the message that explains why. */
export const FieldContext = createContext<{ invalid: boolean; describedBy?: string } | null>(null);

/** After a failed submit, take keyboard and screen-reader users straight to the first field with a problem. */
export function focusFirstInvalid(root: ParentNode = document) {
  requestAnimationFrame(() => {
    const el = root.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

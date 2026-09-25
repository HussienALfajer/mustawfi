import { createContext, useContext } from "react";
import { DEFAULT_DIGIT_SHAPE, type DigitShape } from "./numbers.ts";

/** The signed-in user's digit shape; a per-user display setting later (ADR-0023). */
export const DigitShapeContext = createContext<DigitShape>(DEFAULT_DIGIT_SHAPE);

export function useDigitShape(): DigitShape {
  return useContext(DigitShapeContext);
}

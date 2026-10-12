import { createContext, useContext } from "react";

export type Area = "admin" | "portal" | "auth";

/** Which visual area (admin panel / client portal) a component is rendered in. */
export const AreaContext = createContext<Area>("admin");

export function useArea(): Area {
  return useContext(AreaContext);
}

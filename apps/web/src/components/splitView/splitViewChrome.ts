import { createContext } from "react";

/** True while the split view's project bar shows the project, so the main header leaves it out. */
export const SplitViewChromeContext = createContext(false);

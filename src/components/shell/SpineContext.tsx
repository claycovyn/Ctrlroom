"use client";

import { createContext, useContext } from "react";

export type SpineCtx = { dms: number; activity: number; setAccount: (fn: (() => void) | null) => void };

/** Provided by SpineShell. Its own module so client pages can read it without importing the frame itself, which the
 * (spine) layout renders across the server boundary (importing it from both sides drops it from the client manifest). */
export const SpineContext = createContext<SpineCtx | null>(null);

/** The badges the Spine shows, and a way for the page under it to take over the account button. */
export const useSpine = () => useContext(SpineContext);

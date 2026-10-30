declare const browser: typeof chrome | undefined;

/** `browser` on Firefox, `chrome` elsewhere. Both expose promise APIs under MV3. */
export const ext: typeof chrome = typeof browser !== 'undefined' ? browser : chrome;

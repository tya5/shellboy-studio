// Bundle the approved SVGs; no new bridge route or external image host.
import ask from '../../../app/public/characters/ask-24.svg?url&no-inline';
import error from '../../../app/public/characters/error-24.svg?url&no-inline';
import neutral from '../../../app/public/characters/neutral-24.svg?url&no-inline';
import empty from '../../../app/public/characters/neutral-master.svg?url&no-inline';

export const characterAssets: Readonly<Record<string, string>> = { ask, error, neutral };
export const emptyCharacterAsset = empty;

// Bundle the approved SVGs; no new bridge route or external image host.
import ask from '../../../app/public/characters/ask-24.svg?url&no-inline';
import complete from '../../../app/public/characters/complete-check-24.svg?url&no-inline';
import error from '../../../app/public/characters/error-24.svg?url&no-inline';
import neutral from '../../../app/public/characters/neutral-24.svg?url&no-inline';
import rest from '../../../app/public/characters/rest-24.svg?url&no-inline';
import thinking from '../../../app/public/characters/thinking-24.svg?url&no-inline';
import empty from '../../../app/public/characters/neutral-master.svg?url&no-inline';

export const characterAssets: Readonly<Record<string, string>> = { ask, 'complete-check': complete, error, neutral, rest, thinking };
export const emptyCharacterAsset = empty;

import thinking from '../../../../app/public/characters/thinking-24.svg?raw';
import { characterAssets } from '../../character-assets';

// The tracked asset is the only source of the approved geometry and colors.
const thinkingArtwork = thinking.slice(thinking.indexOf('<rect'), thinking.lastIndexOf('</svg>')).replace(/ id="[^"]*"/g, '');

export function ConversationCharacter({ name, running }: { name: string; running: boolean }) {
  return name === 'thinking'
    ? <svg class="character-status" data-running={running ? '' : undefined} viewBox="0 0 390 390" aria-hidden="true" dangerouslySetInnerHTML={{ __html: thinkingArtwork }} />
    : <img class="character-status" src={characterAssets[name]} alt="" />;
}
